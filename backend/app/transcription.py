from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path
from threading import Lock
from typing import Any, Iterable, cast

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
from app.postprocess import postprocess_transcript_text
from app.replacements import apply_transcript_replacements
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
_TOKEN_AFFIX_RE = re.compile(
    r'^([\'"\u201c\u201d\u00ab\u00bb(\[{<]*)(.*?)([\'"\u201c\u201d\u00ab\u00bb)\]}>.,!?;:\u2026]*)$'
)
_NON_SPEECH_ANNOTATION_RE = re.compile(
    r"[\[(](?:"
    r"\u043c\u0443\u0437\u044b\u043a\u0430|"
    r"\u0441\u043c\u0435\u0445|"
    r"\u0430\u043f\u043b\u043e\u0434\u0438\u0441\u043c\u0435\u043d\u0442\u044b|"
    r"\u0442\u0438\u0448\u0438\u043d\u0430|"
    r"\u0448\u0443\u043c|"
    r"music|laughter|applause|silence|noise"
    r")[\])]",
    re.IGNORECASE,
)
_EXCESSIVE_REPEAT_RE = re.compile(r"([A-Za-z\u0400-\u04FF])\1{3,}")
_HYPHEN_SPLIT_RE = re.compile(r"[-\u2010\u2011\u2012\u2013\u2014]+")
_CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_LETTER_RE = re.compile(r"[A-Za-z\u0400-\u04FF]")
_VOWEL_RE = re.compile(
    r"[\u0430\u0435\u0451\u0438\u043e\u0443\u044b\u044d\u044e\u044faeiouy]",
    re.IGNORECASE,
)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CYRILLIC_WORD_RE = re.compile(r"[\u0400-\u04FF]{2,}")
_LATIN_WORD_RE = re.compile(r"[A-Za-z]{2,}")


class LocalTranscriptionError(RuntimeError):
    pass


def queue_transcription(tweet_id: int) -> None:
    logger.info("Queueing transcription task", extra={"tweet_id": tweet_id})
    transcribe_voice_tweet.delay(tweet_id)


def get_queue_depth() -> int:
    try:
        redis_client = redis.Redis.from_url(settings.redis_url)
        return cast(int, redis_client.llen(settings.celery_queue_name))
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
        cpu_threads=settings.whisper_cpu_threads,
        num_workers=settings.whisper_num_workers,
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


def _resolve_primary_language() -> str:
    language = (settings.whisper_language or "ru").strip().lower()
    return language or "ru"


def _collect_segments(segments: Iterable[Any]) -> list[Any]:
    return list(segments)


def _build_transcript(segments: Iterable[Any]) -> str:
    return " ".join(segment.text.strip() for segment in segments if getattr(segment, "text", "").strip()).strip()


def _is_protected_transcript_token(token: str) -> bool:
    lower_token = token.lower()
    if token.startswith(("#", "@")):
        return True
    if any(character.isdigit() for character in token):
        return True
    if "://" in lower_token or lower_token.startswith("www."):
        return True
    if _EMAIL_RE.match(token):
        return True
    # Keep domain-like and path-like tokens intact; they are often usernames, links, or product names.
    return (_LATIN_RE.search(token) is not None) and any(separator in token for separator in (".", "/", "_"))


def _looks_like_plausible_word(token: str) -> bool:
    if not token:
        return False
    if _is_protected_transcript_token(token):
        return True

    letters = _LETTER_RE.findall(token)
    if not letters:
        return True
    if len(letters) <= 3:
        return True

    fragments = [fragment for fragment in _HYPHEN_SPLIT_RE.split(token) if fragment]
    if len(fragments) >= 4 and all(len(_LETTER_RE.findall(fragment)) <= 3 for fragment in fragments):
        return False

    has_cyrillic = _CYRILLIC_RE.search(token) is not None
    has_latin = _LATIN_RE.search(token) is not None
    if has_cyrillic and has_latin:
        latin_letters = [character for character in token if _LATIN_RE.match(character)]
        # Mixed lowercase scripts are usually ASR artifacts. Keep branded uppercase suffixes like GPT.
        if len(letters) > 4 and not any(character.isupper() for character in latin_letters):
            return False

    vowel_count = len(_VOWEL_RE.findall(token))
    if len(letters) >= 5 and vowel_count == 0:
        return False
    if len(letters) >= 12 and vowel_count / len(letters) < 0.18:
        return False

    normalized_letters = [letter.casefold() for letter in letters]
    most_common_letter_count = max(normalized_letters.count(letter) for letter in set(normalized_letters))
    return most_common_letter_count / len(normalized_letters) <= 0.65


def _sanitize_transcript_token(token: str) -> str | None:
    match = _TOKEN_AFFIX_RE.match(token)
    if not match:
        return token

    prefix, core, suffix = match.groups()
    if not core:
        return None
    if _is_protected_transcript_token(core):
        return token

    normalized_core = _EXCESSIVE_REPEAT_RE.sub(lambda repeated: repeated.group(1) * 2, core)
    if not _looks_like_plausible_word(normalized_core):
        return None
    return f"{prefix}{normalized_core}{suffix}"


def _sanitize_transcript_text(text: str) -> str:
    without_annotations = _NON_SPEECH_ANNOTATION_RE.sub(" ", text)
    cleaned_tokens = [
        cleaned_token for token in without_annotations.split() if (cleaned_token := _sanitize_transcript_token(token))
    ]
    cleaned_text = " ".join(cleaned_tokens)
    cleaned_text = re.sub(r"\s+([.,!?;:\u2026])", r"\1", cleaned_text)
    cleaned_text = re.sub(r"([\u00ab(\[{])\s+", r"\1", cleaned_text)
    cleaned_text = re.sub(r"\s+([\u00bb)\]}])", r"\1", cleaned_text)
    return cleaned_text.strip()


def _average_no_speech_probability(segments: Iterable[Any]) -> float:
    probabilities = [float(getattr(segment, "no_speech_prob", 0.0) or 0.0) for segment in segments]
    if not probabilities:
        return 1.0
    return sum(probabilities) / len(probabilities)


def _parse_temperature_fallback() -> list[float]:
    raw_temperatures = (settings.whisper_temperature_fallback or "").strip()
    if not raw_temperatures:
        return [settings.whisper_temperature]

    temperatures: list[float] = []
    for raw_temperature in raw_temperatures.split(","):
        raw_temperature = raw_temperature.strip()
        if not raw_temperature:
            continue
        try:
            temperatures.append(float(raw_temperature))
        except ValueError:
            logger.warning("Ignoring invalid Whisper temperature", extra={"temperature": raw_temperature})

    return temperatures or [settings.whisper_temperature]


def _build_vad_parameters() -> dict[str, float | int]:
    return {
        "threshold": settings.whisper_vad_threshold,
        "min_silence_duration_ms": settings.whisper_vad_min_silence_duration_ms,
        "min_speech_duration_ms": settings.whisper_vad_min_speech_duration_ms,
        "speech_pad_ms": settings.whisper_vad_speech_pad_ms,
    }


def _language_score(text: str, language: str) -> float:
    cyrillic_words = len(_CYRILLIC_WORD_RE.findall(text))
    latin_words = len(_LATIN_WORD_RE.findall(text))
    total_words = cyrillic_words + latin_words
    if total_words == 0:
        return 0.0
    if language == "ru":
        return cyrillic_words / total_words
    if language == "en":
        return latin_words / total_words
    return 0.0


def _should_try_english_fallback(transcript: str, no_speech_probability: float, primary_language: str) -> bool:
    if primary_language == "en":
        return False
    if not transcript or no_speech_probability > settings.whisper_no_speech_threshold:
        return True
    if primary_language == "ru" and _language_score(transcript, "ru") < 0.35:
        return True
    return False


def _should_use_english_fallback(primary_transcript: str, fallback_transcript: str) -> bool:
    if not fallback_transcript:
        return False
    if not primary_transcript:
        return True
    return _language_score(fallback_transcript, "en") > _language_score(primary_transcript, "ru") + 0.25


def _transcribe_with_language(model: Any, file_path: str, *, language: str) -> tuple[str, float]:
    segments, _ = model.transcribe(
        file_path,
        beam_size=settings.whisper_beam_size,
        best_of=settings.whisper_best_of,
        patience=settings.whisper_patience,
        length_penalty=settings.whisper_length_penalty,
        repetition_penalty=settings.whisper_repetition_penalty,
        no_repeat_ngram_size=settings.whisper_no_repeat_ngram_size,
        language=language,
        task=settings.whisper_task,
        vad_filter=settings.whisper_vad_filter,
        vad_parameters=_build_vad_parameters() if settings.whisper_vad_filter else None,
        temperature=_parse_temperature_fallback(),
        compression_ratio_threshold=settings.whisper_compression_ratio_threshold,
        log_prob_threshold=settings.whisper_log_prob_threshold,
        no_speech_threshold=settings.whisper_no_speech_threshold,
        condition_on_previous_text=settings.whisper_condition_on_previous_text,
        prompt_reset_on_temperature=settings.whisper_prompt_reset_on_temperature,
        initial_prompt=settings.whisper_initial_prompt,
        hotwords=settings.whisper_hotwords,
        word_timestamps=settings.whisper_word_timestamps,
        hallucination_silence_threshold=settings.whisper_hallucination_silence_threshold,
        language_detection_threshold=settings.whisper_language_detection_threshold,
        language_detection_segments=settings.whisper_language_detection_segments,
    )
    collected_segments = _collect_segments(segments)
    raw_transcript = _build_transcript(collected_segments)
    transcript = _sanitize_transcript_text(raw_transcript)
    transcript = apply_transcript_replacements(transcript)
    transcript = postprocess_transcript_text(transcript, language=language)
    if raw_transcript and transcript != raw_transcript:
        logger.debug(
            "Post-processed transcription text",
            extra={"language": language, "raw_length": len(raw_transcript), "cleaned_length": len(transcript)},
        )
    no_speech_probability = _average_no_speech_probability(collected_segments)
    return transcript, no_speech_probability


def transcribe_audio(file_path: str) -> str:
    model = _get_whisper_model()
    primary_language = _resolve_primary_language()
    transcript, no_speech_probability = _transcribe_with_language(model, file_path, language=primary_language)

    if _should_try_english_fallback(transcript, no_speech_probability, primary_language):
        fallback_transcript, fallback_no_speech_probability = _transcribe_with_language(model, file_path, language="en")
        if _should_use_english_fallback(transcript, fallback_transcript):
            logger.info(
                "Using English transcription fallback after low-confidence primary pass",
                extra={
                    "primary_language": primary_language,
                    "primary_no_speech_probability": no_speech_probability,
                    "fallback_no_speech_probability": fallback_no_speech_probability,
                },
            )
            return fallback_transcript

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
        if not tweet.audio_url:
            raise LocalTranscriptionError("Tweet has no audio file to transcribe.")

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
        publish_public_event(
            "tweet.transcription_updated", tweet_id=tweet.id, status=tweet.status.value, user_id=tweet.user_id
        )
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
            publish_public_event(
                "tweet.transcription_updated", tweet_id=tweet.id, status=tweet.status.value, user_id=tweet.user_id
            )
            publish_user_event(
                tweet.user_id, "tweet.transcription_updated", tweet_id=tweet.id, status=tweet.status.value
            )
        raise
    finally:
        if normalized_path and normalized_path.exists():
            normalized_path.unlink(missing_ok=True)
        db.close()
