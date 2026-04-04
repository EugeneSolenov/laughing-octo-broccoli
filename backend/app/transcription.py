from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from threading import Lock
from typing import Any

import redis
from celery import Celery
from celery.exceptions import MaxRetriesExceededError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.events import publish_public_event, publish_user_event
from app.media import normalize_audio_for_whisper
from app.models import NotificationType, TweetStatus, VoiceTweet
from app.observability import configure_observability
from app.social import create_notification
from app.storage import storage

configure_observability(worker=True)
celery_app = Celery("voice_twitter", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_track_started=True,
    result_expires=3600,
    timezone="UTC",
    broker_connection_retry_on_startup=True,
    worker_max_tasks_per_child=25,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=settings.transcription_soft_time_limit_seconds,
    task_time_limit=settings.transcription_hard_time_limit_seconds,
)

logger = logging.getLogger(__name__)
_MODEL_LOCK = Lock()
_MODEL_EXECUTOR = ThreadPoolExecutor(max_workers=1)
_MODEL_FUTURE = None
_WHISPER_MODEL: Any | None = None


class LocalTranscriptionError(RuntimeError):
    pass


def queue_transcription(tweet_id: int) -> None:
    logger.info("Queueing transcription task", extra={"tweet_id": tweet_id})
    transcribe_voice_tweet.delay(tweet_id)


def get_queue_depth() -> int:
    try:
        redis_client = redis.Redis.from_url(settings.redis_url)
        return int(redis_client.llen(settings.celery_queue_name))
    except Exception:
        logger.exception("Failed to inspect queue depth")
        return 0


def _build_whisper_model():
    from faster_whisper import WhisperModel

    settings.whisper_model_path.mkdir(parents=True, exist_ok=True)
    return WhisperModel(
        settings.whisper_model_size,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
        download_root=str(settings.whisper_model_path),
    )


def _get_whisper_model():
    global _MODEL_FUTURE, _WHISPER_MODEL

    if _WHISPER_MODEL is not None:
        return _WHISPER_MODEL

    with _MODEL_LOCK:
        if _WHISPER_MODEL is not None:
            return _WHISPER_MODEL
        if _MODEL_FUTURE is None:
            _MODEL_FUTURE = _MODEL_EXECUTOR.submit(_build_whisper_model)

    try:
        model = _MODEL_FUTURE.result(timeout=settings.whisper_load_timeout_seconds)
    except FuturesTimeoutError as exc:
        raise LocalTranscriptionError(
            f"Whisper model loading exceeded {settings.whisper_load_timeout_seconds} seconds."
        ) from exc
    except Exception:
        with _MODEL_LOCK:
            _MODEL_FUTURE = None
        raise

    with _MODEL_LOCK:
        _WHISPER_MODEL = model

    return _WHISPER_MODEL


def transcribe_audio(file_path: str) -> str:
    model = _get_whisper_model()
    segments, _ = model.transcribe(
        file_path,
        beam_size=settings.whisper_beam_size,
        language=settings.whisper_language,
        vad_filter=settings.whisper_vad_filter,
        condition_on_previous_text=False,
    )
    transcript = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    if not transcript:
        raise LocalTranscriptionError("Faster-Whisper returned an empty transcription.")
    return transcript


@celery_app.task(
    bind=True,
    name="voice_twitter.transcribe_voice_tweet",
    max_retries=settings.transcription_max_retries,
)
def transcribe_voice_tweet(self, tweet_id: int) -> None:
    db: Session = SessionLocal()
    tweet: VoiceTweet | None = None
    normalized_path: Path | None = None

    try:
        tweet = db.get(VoiceTweet, tweet_id)
        if tweet is None or tweet.status == TweetStatus.completed:
            return

        with storage.processing_path(tweet.audio_url) as source_path:
            if not source_path.exists():
                raise LocalTranscriptionError("Uploaded audio file is missing from storage.")

            normalized_path = normalize_audio_for_whisper(source_path)
            transcript = transcribe_audio(str(normalized_path))

        tweet.transcription_text = transcript
        tweet.status = TweetStatus.completed
        tweet.error_message = None
        db.add(tweet)
        notification = None
        if tweet.user.notifications_enabled:
            notification = create_notification(
                db,
                user_id=tweet.user_id,
                notification_type=NotificationType.transcription_ready,
                tweet_id=tweet.id,
            )
        db.commit()
        logger.info("Transcription completed", extra={"tweet_id": tweet_id})
        publish_public_event("tweet.transcription_updated", tweet_id=tweet.id, status=tweet.status.value, user_id=tweet.user_id)
        publish_user_event(tweet.user_id, "tweet.transcription_updated", tweet_id=tweet.id, status=tweet.status.value)
        if notification:
            publish_user_event(
                tweet.user_id,
                "notification.created",
                notification_id=notification.id,
                notification_type=notification.type.value,
                tweet_id=tweet.id,
            )
    except Exception as exc:
        if tweet is not None:
            if self.request.retries < self.max_retries:
                tweet.status = TweetStatus.processing
                tweet.error_message = f"Retrying transcription ({self.request.retries + 1}/{self.max_retries})..."
                db.add(tweet)
                db.commit()
                logger.exception(
                    "Transcription attempt failed; scheduling retry",
                    extra={"tweet_id": tweet_id, "retry": self.request.retries + 1},
                )
                try:
                    raise self.retry(exc=exc, countdown=settings.transcription_retry_delay_seconds)
                except MaxRetriesExceededError:
                    pass

            tweet.status = TweetStatus.error
            tweet.error_message = str(exc)
            db.add(tweet)
            db.commit()
            logger.exception("Transcription failed permanently", extra={"tweet_id": tweet_id})
            publish_public_event("tweet.transcription_updated", tweet_id=tweet.id, status=tweet.status.value, user_id=tweet.user_id)
            publish_user_event(tweet.user_id, "tweet.transcription_updated", tweet_id=tweet.id, status=tweet.status.value)
        raise
    finally:
        if normalized_path and normalized_path.exists():
            normalized_path.unlink(missing_ok=True)
        db.close()
