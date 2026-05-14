from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from typing import cast

import redis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from app.config import settings
from app.csrf import csrf_middleware
from app.database import engine, init_db
from app.logging_setup import configure_logging
from app.observability import configure_observability
from app.rate_limit import limiter
from app.routers import admin, auth, events, notifications, tweets, users
from app.storage import storage

configure_logging(settings.log_level)
configure_observability()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.storage_backend == "local":
        settings.uploads_path.mkdir(parents=True, exist_ok=True)
    settings.whisper_model_path.mkdir(parents=True, exist_ok=True)
    init_db()
    logger.info(
        "Application startup complete",
        extra={
            "environment": settings.environment,
            "storage_backend": settings.storage_backend,
        },
    )
    yield


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)
app.state.limiter = limiter
rate_limit_handler = cast(
    Callable[[Request, Exception], StarletteResponse | Awaitable[StarletteResponse]],
    _rate_limit_exceeded_handler,
)
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
app.add_middleware(SlowAPIMiddleware)
app.middleware("http")(csrf_middleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin_value],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.mount(
    settings.static_upload_prefix,
    StaticFiles(directory=str(settings.uploads_path), check_dir=False),
    name="uploads",
)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/ready")
def readiness() -> JSONResponse:
    checks = {
        "database": {"ok": False, "detail": ""},
        "redis": {"ok": False, "detail": ""},
        "storage": {"ok": False, "detail": ""},
    }

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        checks["database"] = {"ok": True, "detail": "ok"}
    except Exception as exc:
        checks["database"] = {"ok": False, "detail": str(exc)}

    try:
        redis.Redis.from_url(settings.redis_url).ping()
        checks["redis"] = {"ok": True, "detail": "ok"}
    except Exception as exc:
        checks["redis"] = {"ok": False, "detail": str(exc)}

    storage_ok, storage_detail = storage.healthcheck()
    checks["storage"] = {"ok": storage_ok, "detail": storage_detail}

    ready = all(item["ok"] for item in checks.values())
    status_code = 200 if ready else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ready" if ready else "degraded",
            "checks": checks,
        },
    )


app.include_router(auth.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(tweets.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
