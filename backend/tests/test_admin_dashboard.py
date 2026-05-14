from __future__ import annotations

from app.models import Report, ReportStatus, TweetStatus, User, UserRole, VoiceTweet
from fastapi.testclient import TestClient


def test_admin_can_resolve_report_without_dashboard_error(client: TestClient, db_session, csrf_token: str) -> None:
    register_response = client.post(
        "/api/auth/register",
        headers={
            "X-CSRF-Token": csrf_token,
            "X-Forwarded-For": "198.51.100.52",
        },
        json={
            "username": "adminpilot",
            "email": "adminpilot@example.com",
            "password": "SuperSecret123!",
        },
    )

    assert register_response.status_code == 201

    admin_user = db_session.get(User, register_response.json()["user"]["id"])
    assert admin_user is not None
    admin_user.role = UserRole.admin

    target_user = User(
        username="targetuser",
        email="target@example.com",
        hashed_password="hashed",
        role=UserRole.user,
        is_banned=False,
    )
    reporter = User(
        username="reporteruser",
        email="reporter@example.com",
        hashed_password="hashed",
        role=UserRole.user,
        is_banned=False,
    )
    db_session.add_all([admin_user, target_user, reporter])
    db_session.flush()

    tweet = VoiceTweet(
        user_id=target_user.id,
        audio_url="/uploads/example.wav",
        caption="Reported voice post",
        status=TweetStatus.completed,
        mime_type="audio/wav",
    )
    db_session.add(tweet)
    db_session.flush()

    report = Report(
        reporter_id=reporter.id,
        target_user_id=target_user.id,
        tweet_id=tweet.id,
        reason="Spam",
        status=ReportStatus.open,
    )
    db_session.add(report)
    db_session.commit()
    session_csrf_token = client.cookies.get("csrf_token")

    patch_response = client.patch(
        f"/api/admin/reports/{report.id}",
        headers={"X-CSRF-Token": session_csrf_token},
        json={"status": "resolved"},
    )

    assert patch_response.status_code == 200
    assert patch_response.json()["stats"]["open_reports"] == 0
    db_session.refresh(report)
    assert report.status == ReportStatus.resolved
