from __future__ import annotations

import secrets
from collections.abc import Awaitable, Callable

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse

from app.config import settings

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_csrf_cookie(response: Response, token: str | None = None) -> str:
    csrf_token = token or generate_csrf_token()
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=csrf_token,
        httponly=False,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
    )
    return csrf_token


def ensure_csrf_cookie(response: Response, request: Request) -> str:
    existing_token = request.cookies.get(settings.csrf_cookie_name)
    if existing_token:
        return existing_token
    return set_csrf_cookie(response)


async def csrf_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    csrf_cookie = request.cookies.get(settings.csrf_cookie_name)

    if request.method.upper() not in SAFE_METHODS:
        csrf_header = request.headers.get(settings.csrf_header_name)
        if not csrf_cookie or not csrf_header or not secrets.compare_digest(csrf_cookie, csrf_header):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Invalid CSRF token."},
            )

    response = await call_next(request)

    if not csrf_cookie:
        existing_cookies = response.headers.getlist("set-cookie") if hasattr(response.headers, "getlist") else []
        if not any(cookie.startswith(f"{settings.csrf_cookie_name}=") for cookie in existing_cookies):
            set_csrf_cookie(response)

    return response
