from __future__ import annotations

from datetime import UTC, datetime

from app import main as main_module
from app.models import AuthSession
from fastapi.testclient import TestClient


def test_register_requires_csrf_header(client: TestClient, csrf_token: str) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "username": "voicepilot",
            "email": "voicepilot@example.com",
            "password": "SuperSecret123!",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid CSRF token."


def test_register_creates_session_and_lists_devices(client: TestClient, csrf_token: str) -> None:
    register_response = client.post(
        "/api/auth/register",
        headers={
            "X-CSRF-Token": csrf_token,
            "X-Forwarded-For": "198.51.100.41",
        },
        json={
            "username": "voicepilot",
            "email": "voicepilot@example.com",
            "password": "SuperSecret123!",
        },
    )

    assert register_response.status_code == 201
    assert register_response.json()["user"]["username"] == "voicepilot"

    session_response = client.get("/api/auth/session")
    assert session_response.status_code == 200
    assert session_response.json()["user"]["email"] == "voicepilot@example.com"

    sessions_response = client.get("/api/auth/sessions")
    assert sessions_response.status_code == 200
    assert len(sessions_response.json()["items"]) == 1
    assert sessions_response.json()["items"][0]["current"] is True


def test_list_sessions_excludes_revoked_sessions(client: TestClient, db_session, csrf_token: str) -> None:
    register_response = client.post(
        "/api/auth/register",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "username": "voicepilot",
            "email": "voicepilot@example.com",
            "password": "SuperSecret123!",
        },
    )

    assert register_response.status_code == 201
    user_id = register_response.json()["user"]["id"]

    db_session.add(
        AuthSession(
            id="00000000-0000-0000-0000-000000000999",
            user_id=user_id,
            user_agent="Old browser",
            ip_address="127.0.0.1",
            revoked_at=datetime.now(UTC),
        )
    )
    db_session.commit()

    sessions_response = client.get("/api/auth/sessions")

    assert sessions_response.status_code == 200
    session_ids = {item["id"] for item in sessions_response.json()["items"]}
    assert "00000000-0000-0000-0000-000000000999" not in session_ids
    assert len(session_ids) == 1


def test_change_password_revokes_existing_sessions_immediately(client: TestClient, csrf_token: str) -> None:
    register_response = client.post(
        "/api/auth/register",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "username": "voicepilot",
            "email": "voicepilot@example.com",
            "password": "SuperSecret123!",
        },
    )

    assert register_response.status_code == 201

    with TestClient(main_module.app) as second_client:
        second_csrf_response = second_client.get("/api/auth/csrf")
        assert second_csrf_response.status_code == 200
        second_csrf_token = second_csrf_response.json()["csrf_token"]

        second_login_response = second_client.post(
            "/api/auth/login",
            headers={"X-CSRF-Token": second_csrf_token},
            json={"email": "voicepilot@example.com", "password": "SuperSecret123!"},
        )
        assert second_login_response.status_code == 200
        second_session_csrf = second_client.cookies.get("csrf_token")

        change_password_response = second_client.post(
            "/api/auth/change-password",
            headers={"X-CSRF-Token": second_session_csrf},
            json={
                "current_password": "SuperSecret123!",
                "new_password": "EvenStronger456!",
            },
        )
        assert change_password_response.status_code == 200

        assert client.get("/api/auth/session").status_code == 401
        assert second_client.get("/api/auth/session").status_code == 401


def test_session_restores_from_refresh_cookie_when_access_cookie_is_missing(
    client: TestClient, csrf_token: str
) -> None:
    register_response = client.post(
        "/api/auth/register",
        headers={"X-CSRF-Token": csrf_token},
        json={
            "username": "voicepilot",
            "email": "voicepilot@example.com",
            "password": "SuperSecret123!",
        },
    )

    assert register_response.status_code == 201
    refresh_cookie_before = client.cookies.get("refresh_token")
    assert refresh_cookie_before

    client.cookies.delete("access_token")

    session_response = client.get("/api/auth/session")

    assert session_response.status_code == 200
    assert session_response.json()["user"]["email"] == "voicepilot@example.com"
    assert client.cookies.get("access_token")
    assert client.cookies.get("refresh_token") != ""
