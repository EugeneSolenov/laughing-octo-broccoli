from __future__ import annotations

from app.auth import hash_password
from app.models import Notification, TweetStatus, User, UserRole, VoiceTweet, follows, tweet_likes, tweet_reposts
from fastapi.testclient import TestClient
from sqlalchemy import insert, select


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


def test_feed_returns_root_posts_in_reverse_chronological_order(
    client: TestClient, db_session, csrf_token: str
) -> None:
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


def test_likes_and_reposts_respect_notifications_preference(client: TestClient, db_session, csrf_token: str) -> None:
    author = create_user(email="author@example.com", username="author")
    author.notifications_enabled = False
    listener = create_user(email="listener@example.com", username="listener")
    db_session.add_all([author, listener])
    db_session.flush()

    tweet = VoiceTweet(
        user_id=author.id,
        audio_url="/uploads/creator.ogg",
        caption="Creator clip",
        transcription_text="A strong creator transcript",
        status=TweetStatus.completed,
        mime_type="audio/ogg",
    )
    db_session.add(tweet)
    db_session.commit()

    login(client, listener.email, csrf_token)
    session_csrf_token = client.cookies.get("csrf_token")

    like_response = client.post(f"/api/tweets/{tweet.id}/like", headers={"X-CSRF-Token": session_csrf_token})
    repost_response = client.post(f"/api/tweets/{tweet.id}/repost", headers={"X-CSRF-Token": session_csrf_token})

    assert like_response.status_code == 200
    assert repost_response.status_code == 200

    db_session.expire_all()
    notifications = db_session.scalars(select(Notification).where(Notification.user_id == author.id)).all()
    assert notifications == []


def test_text_reply_without_audio_is_created(client: TestClient, db_session, csrf_token: str) -> None:
    author = create_user(email="author@example.com", username="author")
    listener = create_user(email="listener@example.com", username="listener")
    db_session.add_all([author, listener])
    db_session.flush()

    tweet = VoiceTweet(
        user_id=author.id,
        audio_url="/uploads/creator.ogg",
        caption="Creator clip",
        transcription_text="A strong creator transcript",
        status=TweetStatus.completed,
        mime_type="audio/ogg",
    )
    db_session.add(tweet)
    db_session.commit()

    login(client, listener.email, csrf_token)
    session_csrf_token = client.cookies.get("csrf_token")

    response = client.post(
        f"/api/tweets/{tweet.id}/reply",
        headers={"X-CSRF-Token": session_csrf_token},
        data={"caption": "Text-only reply"},
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["audio_url"] == ""
    assert payload["caption"] == "Text-only reply"
    assert payload["parent_tweet_id"] == tweet.id
    assert payload["status"] == "completed"

    db_session.expire_all()
    reply = db_session.scalar(select(VoiceTweet).where(VoiceTweet.parent_tweet_id == tweet.id))
    assert reply is not None
    assert reply.audio_url is None
    assert reply.mime_type is None


def test_reply_to_reply_is_rejected(client: TestClient, db_session, csrf_token: str) -> None:
    author = create_user(email="author@example.com", username="author")
    listener = create_user(email="listener@example.com", username="listener")
    db_session.add_all([author, listener])
    db_session.flush()

    tweet = VoiceTweet(
        user_id=author.id,
        audio_url="/uploads/creator.ogg",
        caption="Creator clip",
        transcription_text="A strong creator transcript",
        status=TweetStatus.completed,
        mime_type="audio/ogg",
    )
    db_session.add(tweet)
    db_session.commit()

    login(client, listener.email, csrf_token)
    session_csrf_token = client.cookies.get("csrf_token")

    reply_response = client.post(
        f"/api/tweets/{tweet.id}/reply",
        headers={"X-CSRF-Token": session_csrf_token},
        data={"caption": "First-level reply"},
    )
    assert reply_response.status_code == 202
    reply_id = reply_response.json()["id"]

    nested_response = client.post(
        f"/api/tweets/{reply_id}/reply",
        headers={"X-CSRF-Token": session_csrf_token},
        data={"caption": "Nested reply"},
    )

    assert nested_response.status_code == 422
    assert nested_response.json()["detail"] == "Replies to comments are disabled."
    db_session.expire_all()
    assert db_session.scalar(select(VoiceTweet).where(VoiceTweet.parent_tweet_id == reply_id)) is None


def test_like_and_dislike_are_mutually_exclusive(client: TestClient, db_session, csrf_token: str) -> None:
    author = create_user(email="author@example.com", username="author")
    listener = create_user(email="listener@example.com", username="listener")
    db_session.add_all([author, listener])
    db_session.flush()

    tweet = VoiceTweet(
        user_id=author.id,
        audio_url="/uploads/creator.ogg",
        caption="Creator clip",
        transcription_text="A strong creator transcript",
        status=TweetStatus.completed,
        mime_type="audio/ogg",
    )
    db_session.add(tweet)
    db_session.commit()

    login(client, listener.email, csrf_token)
    session_csrf_token = client.cookies.get("csrf_token")

    dislike_response = client.post(f"/api/tweets/{tweet.id}/dislike", headers={"X-CSRF-Token": session_csrf_token})
    assert dislike_response.status_code == 200
    assert dislike_response.json()["disliked_by_viewer"] is True
    assert dislike_response.json()["liked_by_viewer"] is False

    like_response = client.post(f"/api/tweets/{tweet.id}/like", headers={"X-CSRF-Token": session_csrf_token})
    assert like_response.status_code == 200
    like_payload = like_response.json()
    assert like_payload["liked_by_viewer"] is True
    assert like_payload["disliked_by_viewer"] is False
    assert like_payload["likes_count"] == 1
    assert like_payload["dislikes_count"] == 0

    dislike_again_response = client.post(
        f"/api/tweets/{tweet.id}/dislike", headers={"X-CSRF-Token": session_csrf_token}
    )
    assert dislike_again_response.status_code == 200
    dislike_again_payload = dislike_again_response.json()
    assert dislike_again_payload["liked_by_viewer"] is False
    assert dislike_again_payload["disliked_by_viewer"] is True
    assert dislike_again_payload["likes_count"] == 0
    assert dislike_again_payload["dislikes_count"] == 1

    assert db_session.scalar(select(tweet_likes.c.tweet_id).where(tweet_likes.c.tweet_id == tweet.id)) is None
    assert db_session.scalar(select(tweet_reposts.c.tweet_id).where(tweet_reposts.c.tweet_id == tweet.id)) == tweet.id
