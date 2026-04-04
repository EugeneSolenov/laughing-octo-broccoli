from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import insert

from app.auth import hash_password
from app.models import TweetStatus, User, UserRole, VoiceTweet, follows


def create_user(*, email: str, username: str) -> User:
    return User(
        email=email,
        username=username,
        hashed_password=hash_password("SuperSecret123!"),
        role=UserRole.user,
        is_banned=False,
    )


def login(client: TestClient, email: str, csrf_token: str) -> None:
    response = client.post(
        "/api/auth/login",
        headers={"X-CSRF-Token": csrf_token},
        json={"email": email, "password": "SuperSecret123!"},
    )
    assert response.status_code == 200


def test_feed_returns_root_posts_in_reverse_chronological_order(client: TestClient, db_session, csrf_token: str) -> None:
    author = create_user(email="author@example.com", username="author")
    db_session.add(author)
    db_session.flush()

    root_older = VoiceTweet(
        user_id=author.id,
        audio_url="/uploads/older.ogg",
        caption="Older clip",
        transcription_text="Older transcript",
        status=TweetStatus.completed,
        mime_type="audio/ogg",
    )
    root_newer = VoiceTweet(
        user_id=author.id,
        audio_url="/uploads/newer.ogg",
        caption="Newer clip",
        transcription_text="Newer transcript",
        status=TweetStatus.completed,
        mime_type="audio/ogg",
    )
    db_session.add_all([root_older, root_newer])
    db_session.flush()
    reply = VoiceTweet(
        user_id=author.id,
        parent_tweet_id=root_newer.id,
        audio_url="/uploads/reply.ogg",
        caption="Reply clip",
        transcription_text="Reply transcript",
        status=TweetStatus.completed,
        mime_type="audio/ogg",
    )
    db_session.add(reply)
    db_session.commit()

    response = client.get("/api/tweets/feed")

    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload["items"]] == [root_newer.id, root_older.id]
    assert all(item["parent_tweet_id"] is None for item in payload["items"])
    assert payload["items"][0]["reply_count"] == 1


def test_following_feed_and_public_profile_work(client: TestClient, db_session, csrf_token: str) -> None:
    listener = create_user(email="listener@example.com", username="listener")
    creator = create_user(email="creator@example.com", username="creator")
    outsider = create_user(email="outsider@example.com", username="outsider")
    db_session.add_all([listener, creator, outsider])
    db_session.flush()

    creator_tweet = VoiceTweet(
        user_id=creator.id,
        audio_url="/uploads/creator.ogg",
        caption="Creator clip",
        transcription_text="A strong creator transcript",
        status=TweetStatus.completed,
        mime_type="audio/ogg",
    )
    outsider_tweet = VoiceTweet(
        user_id=outsider.id,
        audio_url="/uploads/outsider.ogg",
        caption="Outsider clip",
        transcription_text="Outside the following graph",
        status=TweetStatus.completed,
        mime_type="audio/ogg",
    )
    db_session.add_all([creator_tweet, outsider_tweet])
    db_session.flush()
    db_session.execute(insert(follows).values(follower_id=listener.id, followed_id=creator.id))
    db_session.commit()

    login(client, listener.email, csrf_token)

    following_response = client.get("/api/tweets/feed?scope=following")
    assert following_response.status_code == 200
    assert [item["id"] for item in following_response.json()["items"]] == [creator_tweet.id]

    profile_response = client.get(f"/api/users/{creator.id}")
    assert profile_response.status_code == 200
    profile_payload = profile_response.json()
    assert profile_payload["user"]["username"] == "creator"
    assert profile_payload["user"]["is_following"] is True
    assert "email" not in profile_payload["user"]
