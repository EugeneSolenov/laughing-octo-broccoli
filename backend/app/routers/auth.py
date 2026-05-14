from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth import (
    AuthenticatedUser,
    clear_auth_cookies,
    create_auth_session,
    decode_token,
    get_current_refresh_context,
    get_optional_refresh_context,
    get_optional_user,
    hash_password,
    issue_action_token,
    issue_auth_tokens,
    revoke_all_auth_sessions,
    revoke_auth_session,
    set_auth_cookies,
    touch_auth_session,
    verify_password,
)
from app.csrf import ensure_csrf_cookie
from app.config import settings
from app.database import get_db
from app.models import AuthSession, User, UserRole
from app.rate_limit import limiter
from app.schemas import (
    AuthResponse,
    ChangePasswordRequest,
    CsrfTokenResponse,
    GenericDetailResponse,
    LoginRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    RegisterRequest,
    SessionListResponse,
    TokenActionRequest,
)
from app.serializers import serialize_session, serialize_user

router = APIRouter()


def _debug_token(token: str) -> str | None:
    return token if not settings.is_production else None


@router.get("/auth/csrf", response_model=CsrfTokenResponse)
def get_csrf_token(request: Request, response: Response) -> CsrfTokenResponse:
    csrf_token = ensure_csrf_cookie(response, request)
    return CsrfTokenResponse(csrf_token=csrf_token, detail="CSRF token ready.")


@router.post("/auth/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.auth_register_rate_limit)
def register(request: Request, payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
    existing_user = db.scalar(
        select(User).where(or_(User.email == payload.email.lower(), User.username == payload.username.strip()))
    )
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username or email is already registered.")

    user = User(
        username=payload.username.strip(),
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        role=UserRole.user,
    )
    db.add(user)
    db.flush()
    session = create_auth_session(db, user=user, request=request)
    access_token, refresh_token = issue_auth_tokens(user, session_id=session.id)
    db.commit()
    db.refresh(user)

    set_auth_cookies(response, access_token, refresh_token)
    return AuthResponse(user=serialize_user(user), detail="Registration successful.")


@router.post("/auth/login", response_model=AuthResponse)
@limiter.limit(settings.auth_login_rate_limit)
def login(request: Request, payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    if user.is_banned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is banned.")

    session = create_auth_session(db, user=user, request=request)
    access_token, refresh_token = issue_auth_tokens(user, session_id=session.id)
    db.commit()
    db.refresh(user)

    set_auth_cookies(response, access_token, refresh_token)
    return AuthResponse(user=serialize_user(user), detail="Login successful.")


@router.post("/auth/refresh", response_model=AuthResponse)
def refresh_session(
    request: Request,
    response: Response,
    context=Depends(get_current_refresh_context),
    db: Session = Depends(get_db),
) -> AuthResponse:
    touch_auth_session(db, context.session)
    if not context.session.user_agent and request.headers.get("user-agent"):
        context.session.user_agent = request.headers.get("user-agent")
    access_token, refresh_token = issue_auth_tokens(context.user, session_id=context.session.id)
    db.commit()
    set_auth_cookies(response, access_token, refresh_token)
    return AuthResponse(user=serialize_user(context.user), detail="Session refreshed.")


@router.get("/auth/session", response_model=AuthResponse)
def get_session(
    request: Request,
    response: Response,
    current_user=Depends(get_optional_user),
    refresh_context=Depends(get_optional_refresh_context),
    db: Session = Depends(get_db),
) -> AuthResponse:
    if current_user is not None:
        return AuthResponse(user=serialize_user(current_user), detail="Session active.")
    if refresh_context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    touch_auth_session(db, refresh_context.session)
    if not refresh_context.session.user_agent and request.headers.get("user-agent"):
        refresh_context.session.user_agent = request.headers.get("user-agent")
    access_token, refresh_token = issue_auth_tokens(refresh_context.user, session_id=refresh_context.session.id)
    db.commit()
    set_auth_cookies(response, access_token, refresh_token)
    return AuthResponse(user=serialize_user(refresh_context.user), detail="Session active.")


@router.get("/auth/sessions", response_model=SessionListResponse)
def list_sessions(
    current_user: AuthenticatedUser,
    current_context=Depends(get_optional_refresh_context),
    db: Session = Depends(get_db),
) -> SessionListResponse:
    sessions = db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == current_user.id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.created_at.desc())
    ).all()
    current_id = current_context.session.id if current_context else None
    return SessionListResponse(items=[serialize_session(item, current=item.id == current_id) for item in sessions])


@router.delete("/auth/sessions/{session_id}", response_model=GenericDetailResponse)
def revoke_session(
    session_id: str,
    response: Response,
    current_user: AuthenticatedUser,
    current_context=Depends(get_optional_refresh_context),
    db: Session = Depends(get_db),
) -> GenericDetailResponse:
    session = db.get(AuthSession, session_id)
    if session is None or session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    revoke_auth_session(db, session)
    db.commit()
    if current_context and current_context.session.id == session_id:
        clear_auth_cookies(response)
    return GenericDetailResponse(detail="Session revoked.")


@router.post("/auth/logout-all", response_model=GenericDetailResponse)
def logout_all(response: Response, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> GenericDetailResponse:
    revoke_all_auth_sessions(db, user_id=current_user.id)
    db.commit()
    clear_auth_cookies(response)
    return GenericDetailResponse(detail="Logged out from all devices.")


@router.post("/auth/change-password", response_model=GenericDetailResponse)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    current_user: AuthenticatedUser,
    db: Session = Depends(get_db),
) -> GenericDetailResponse:
    user = db.get(User, current_user.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")

    user.hashed_password = hash_password(payload.new_password)
    db.add(user)
    revoke_all_auth_sessions(db, user_id=user.id)
    db.commit()
    clear_auth_cookies(response)
    return GenericDetailResponse(detail="Password updated.")


@router.post("/auth/request-email-verification", response_model=GenericDetailResponse)
def request_email_verification(current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> GenericDetailResponse:
    user = db.get(User, current_user.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if user.email_verified:
        return GenericDetailResponse(detail="Email is already verified.")

    token = issue_action_token(
        user,
        token_type="email_verify",
        expires_delta=timedelta(minutes=settings.email_verification_expire_minutes),
    )
    return GenericDetailResponse(detail="Verification token created.", debug_token=_debug_token(token))


@router.post("/auth/verify-email", response_model=GenericDetailResponse)
def verify_email(payload: TokenActionRequest, db: Session = Depends(get_db)) -> GenericDetailResponse:
    token_payload = decode_token(payload.token, expected_type="email_verify")
    user = db.get(User, token_payload.sub)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if token_payload.email and user.email != token_payload.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification token is invalid.")
    user.email_verified = True
    db.add(user)
    db.commit()
    return GenericDetailResponse(detail="Email verified.")


@router.post("/auth/request-password-reset", response_model=GenericDetailResponse)
@limiter.limit(settings.auth_login_rate_limit)
def request_password_reset(
    request: Request,
    response: Response,
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
) -> GenericDetailResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None:
        return GenericDetailResponse(detail="If the email exists, a reset token has been created.")

    token = issue_action_token(
        user,
        token_type="password_reset",
        expires_delta=timedelta(minutes=settings.password_reset_expire_minutes),
    )
    return GenericDetailResponse(
        detail="If the email exists, a reset token has been created.",
        debug_token=_debug_token(token),
    )


@router.post("/auth/reset-password", response_model=GenericDetailResponse)
def reset_password(payload: PasswordResetConfirmRequest, db: Session = Depends(get_db)) -> GenericDetailResponse:
    token_payload = decode_token(payload.token, expected_type="password_reset")
    user = db.get(User, token_payload.sub)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if token_payload.email and user.email != token_payload.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset token is invalid.")
    user.hashed_password = hash_password(payload.password)
    db.add(user)
    revoke_all_auth_sessions(db, user_id=user.id)
    db.commit()
    return GenericDetailResponse(detail="Password has been reset.")


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    current_context=Depends(get_optional_refresh_context),
    db: Session = Depends(get_db),
) -> Response:
    if current_context is not None:
        revoke_auth_session(db, current_context.session)
        db.commit()
    clear_auth_cookies(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
