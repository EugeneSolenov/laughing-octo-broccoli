from __future__ import annotations

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
        headers={"X-CSRF-Token": csrf_token},
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
