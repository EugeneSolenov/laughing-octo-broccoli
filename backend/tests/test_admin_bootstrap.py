from __future__ import annotations

import pytest
from app import database as database_module
from app.auth import hash_password
from app.config import settings
from app.models import User, UserRole


def test_admin_bootstrap_refuses_conflicting_existing_user(db_session) -> None:
    conflicting_user = User(
        username="existing-user",
        email=settings.admin_email.lower(),
        hashed_password=hash_password("SuperSecret123!"),
        role=UserRole.user,
        is_banned=False,
    )
    db_session.add(conflicting_user)
    db_session.commit()

    with pytest.raises(RuntimeError, match="Admin bootstrap conflict"):
        database_module.init_db()

    db_session.refresh(conflicting_user)
    assert conflicting_user.username == "existing-user"
    assert conflicting_user.role == UserRole.user
