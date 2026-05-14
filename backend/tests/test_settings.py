from __future__ import annotations

import pytest
from app.config import Settings
from pydantic import ValidationError


def test_production_rejects_default_secret_key() -> None:
    with pytest.raises(ValidationError):
        Settings(environment="production", secret_key="change-me-in-production-please-1234")


def test_production_rejects_local_storage() -> None:
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            secret_key="a" * 32,
            cookie_secure=True,
            storage_backend="local",
        )


def test_s3_requires_credentials() -> None:
    with pytest.raises(ValidationError):
        Settings(storage_backend="s3", secret_key="a" * 32)


def test_valid_s3_configuration_is_accepted() -> None:
    settings = Settings(
        environment="production",
        secret_key="a" * 32,
        cookie_secure=True,
        storage_backend="s3",
        storage_bucket="voice-media",
        storage_access_key_id="access-key",
        storage_secret_access_key="secret-key",
    )

    assert settings.storage_backend == "s3"
