from __future__ import annotations

from collections.abc import Generator

import logging
from sqlalchemy import create_engine
from sqlalchemy import inspect, select
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.exc import OperationalError

from app.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.auth import hash_password
    from app.models import User, UserRole

    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "users" not in table_names:
        raise RuntimeError("Database schema is missing. Run 'alembic upgrade head' before starting the API.")

    db = SessionLocal()
    try:
        normalized_admin_email = settings.admin_email.lower()
        admin = db.scalar(
            select(User).where(
                User.email == normalized_admin_email,
                User.username == settings.admin_username,
            )
        )
        if admin is not None:
            if admin.role != UserRole.admin:
                raise RuntimeError(
                    "Admin bootstrap conflict: the configured admin email and username belong to a non-admin user."
                )
            admin.is_banned = False
            db.add(admin)
        else:
            email_owner = db.scalar(select(User).where(User.email == normalized_admin_email))
            username_owner = db.scalar(select(User).where(User.username == settings.admin_username))
            conflicts = []
            if email_owner is not None:
                conflicts.append("email")
            if username_owner is not None:
                conflicts.append("username")
            if conflicts:
                conflict_list = ", ".join(conflicts)
                raise RuntimeError(
                    f"Admin bootstrap conflict: configured admin {conflict_list} is already used by another account."
                )

            admin = User(
                username=settings.admin_username,
                email=normalized_admin_email,
                hashed_password=hash_password(settings.admin_password),
                role=UserRole.admin,
                is_banned=False,
            )
            db.add(admin)

        db.commit()
        logger.info("Admin bootstrap completed", extra={"admin_email": settings.admin_email})
    except OperationalError as exc:
        logger.exception("Database bootstrap failed")
        raise RuntimeError("Database is not ready. Run 'alembic upgrade head' first.") from exc
    finally:
        db.close()
