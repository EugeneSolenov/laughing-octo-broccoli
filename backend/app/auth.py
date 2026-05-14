from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import uuid4

from fastapi import Cookie, Depends, HTTPException, Request, Response, status
from jose import JWTError, jwt
from pwdlib import PasswordHash
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.csrf import set_csrf_cookie
from app.database import get_db
from app.models import AuthSession, User, UserRole

password_hash = PasswordHash.recommended()


class TokenPayload(BaseModel):
    sub: int
    role: UserRole | None = None
    type: str
    exp: int
    sid: str | None = None
    email: str | None = None


@dataclass(slots=True)
class RefreshSessionContext:
    user: User
    session: AuthSession


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def _create_token(
    *,
    user: User,
    token_type: str,
    expires_delta: timedelta,
    session_id: str | None = None,
    email: str | None = None,
) -> str:
    expires_at = datetime.now(UTC) + expires_delta
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "type": token_type,
        "exp": expires_at,
    }
    if session_id:
        payload["sid"] = session_id
    if email:
        payload["email"] = email
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def issue_auth_tokens(user: User, *, session_id: str) -> tuple[str, str]:
    access_token = _create_token(
        user=user,
        token_type="access",
        session_id=session_id,
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )
    refresh_token = _create_token(
        user=user,
        token_type="refresh",
        session_id=session_id,
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
    )
    return access_token, refresh_token


def issue_action_token(user: User, *, token_type: str, expires_delta: timedelta) -> str:
    return _create_token(
        user=user,
        token_type=token_type,
        email=user.email,
        expires_delta=expires_delta,
    )


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        key=settings.access_cookie_name,
        value=access_token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=refresh_token,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )
    set_csrf_cookie(response)


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(settings.access_cookie_name, path="/", domain=settings.cookie_domain)
    response.delete_cookie(settings.refresh_cookie_name, path="/", domain=settings.cookie_domain)
    response.delete_cookie(settings.csrf_cookie_name, path="/", domain=settings.cookie_domain)


def create_auth_session(db: Session, *, user: User, request: Request) -> AuthSession:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    client_ip = (
        forwarded_for.split(",")[0].strip() if forwarded_for else (request.client.host if request.client else None)
    )
    session = AuthSession(
        id=str(uuid4()),
        user_id=user.id,
        user_agent=request.headers.get("user-agent"),
        ip_address=client_ip,
    )
    db.add(session)
    db.flush()
    return session


def touch_auth_session(db: Session, session: AuthSession) -> None:
    session.last_seen_at = datetime.now(UTC)
    db.add(session)


def revoke_auth_session(db: Session, session: AuthSession) -> None:
    session.revoked_at = datetime.now(UTC)
    db.add(session)


def revoke_all_auth_sessions(db: Session, *, user_id: int) -> None:
    sessions = db.query(AuthSession).filter(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)).all()
    now = datetime.now(UTC)
    for session in sessions:
        session.revoked_at = now
        db.add(session)


def decode_token(raw_token: str | None, expected_type: str) -> TokenPayload:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required.",
    )
    if not raw_token:
        raise credentials_error

    try:
        payload = jwt.decode(raw_token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        token_payload = TokenPayload(
            sub=int(payload["sub"]),
            role=UserRole(payload["role"]) if payload.get("role") else None,
            type=str(payload["type"]),
            exp=int(payload["exp"]),
            sid=str(payload["sid"]) if payload.get("sid") else None,
            email=str(payload["email"]) if payload.get("email") else None,
        )
    except (JWTError, KeyError, ValueError):
        raise credentials_error from None

    if token_payload.type != expected_type:
        raise credentials_error

    return token_payload


def _load_current_user(raw_token: str | None, expected_type: str, db: Session) -> User:
    token_payload = decode_token(raw_token, expected_type=expected_type)
    user = db.get(User, token_payload.sub)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")
    if expected_type == "access":
        if not token_payload.sid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found.")

        session = db.get(AuthSession, token_payload.sid)
        if session is None or session.user_id != user.id or session.revoked_at is not None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found.")
    if user.is_banned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is banned.")
    return user


def get_current_user(
    access_token: Annotated[str | None, Cookie(alias=settings.access_cookie_name)] = None,
    db: Session = Depends(get_db),
) -> User:
    return _load_current_user(access_token, expected_type="access", db=db)


def get_current_refresh_context(
    refresh_token: Annotated[str | None, Cookie(alias=settings.refresh_cookie_name)] = None,
    db: Session = Depends(get_db),
) -> RefreshSessionContext:
    token_payload = decode_token(refresh_token, expected_type="refresh")
    if not token_payload.sid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found.")

    session = db.get(AuthSession, token_payload.sid)
    user = db.get(User, token_payload.sub)
    if user is None or session is None or session.user_id != user.id or session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found.")
    if user.is_banned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is banned.")
    return RefreshSessionContext(user=user, session=session)


def get_current_refresh_user(context: RefreshSessionContext = Depends(get_current_refresh_context)) -> User:
    return context.user


def get_optional_refresh_context(
    refresh_token: Annotated[str | None, Cookie(alias=settings.refresh_cookie_name)] = None,
    db: Session = Depends(get_db),
) -> RefreshSessionContext | None:
    if not refresh_token:
        return None
    try:
        return get_current_refresh_context(refresh_token=refresh_token, db=db)
    except HTTPException:
        return None


def get_optional_user(
    access_token: Annotated[str | None, Cookie(alias=settings.access_cookie_name)] = None,
    db: Session = Depends(get_db),
) -> User | None:
    if not access_token:
        return None
    try:
        return _load_current_user(access_token, expected_type="access", db=db)
    except HTTPException:
        return None


def require_roles(*allowed_roles: UserRole):
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource.",
            )
        return current_user

    return dependency


CurrentUser = Annotated[User, Depends(get_current_user)]
AuthenticatedUser = Annotated[User, Depends(require_roles(UserRole.user, UserRole.admin))]
AdminUser = Annotated[User, Depends(require_roles(UserRole.admin))]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
