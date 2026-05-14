from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from urllib import request
from urllib.error import HTTPError, URLError

from app.config import settings
from app.replacements import apply_transcript_replacements

logger = logging.getLogger(__name__)

_SPACE_BEFORE_PUNCTUATION_RE = re.compile(r"\s+([.,!?;:\u2026])")
_SPACE_AFTER_OPENING_RE = re.compile(r"([\u00ab(\[{])\s+")
_SPACE_BEFORE_CLOSING_RE = re.compile(r"\s+([\u00bb)\]}])")
_SENTENCE_START_RE = re.compile(r"(^|[.!?\u2026]\s+)([a-zа-яё])", re.IGNORECASE)
_CODE_FENCE_RE = re.compile(r"^```(?:\w+)?\s*|\s*```$", re.MULTILINE)
_PROTECTED_TOKEN_RE = re.compile(r"(?:https?://\S+|www\.\S+|[@#][\w\u0400-\u04FF_]+)")


class TranscriptPostprocessError(RuntimeError):
    pass


def _normalize_spacing(text: str) -> str:
    normalized = " ".join(text.split())
    normalized = _SPACE_BEFORE_PUNCTUATION_RE.sub(r"\1", normalized)
    normalized = _SPACE_AFTER_OPENING_RE.sub(r"\1", normalized)
    normalized = _SPACE_BEFORE_CLOSING_RE.sub(r"\1", normalized)
    return normalized.strip()


def _capitalize_sentence_starts(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        return f"{match.group(1)}{match.group(2).upper()}"

    return _SENTENCE_START_RE.sub(replace, text)


def _apply_rule_postprocess(text: str) -> str:
    corrected = text
    if settings.transcription_postprocess_replacements.strip():
        corrected = apply_transcript_replacements(
            corrected,
            raw_replacements=settings.transcription_postprocess_replacements,
        )
    corrected = _normalize_spacing(corrected)
    if settings.transcription_postprocess_capitalize_sentences:
        corrected = _capitalize_sentence_starts(corrected)
    return corrected


def _normalize_postprocess_mode() -> str:
    mode = settings.transcription_postprocess_mode.strip().lower()
    return mode.replace(",", "+").replace(" ", "")


def _clean_llm_response(text: str) -> str:
    cleaned = _CODE_FENCE_RE.sub("", text).strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {'"', "'"}:
        cleaned = cleaned[1:-1].strip()
    return _normalize_spacing(cleaned)


def _protected_tokens(text: str) -> set[str]:
    return set(_PROTECTED_TOKEN_RE.findall(text))


def _is_safe_llm_result(source: str, candidate: str) -> bool:
    if not candidate.strip():
        return False

    source_length = max(len(source), 1)
    candidate_length = len(candidate)
    if candidate_length < source_length * 0.55 or candidate_length > source_length * 1.45:
        return False

    return _protected_tokens(source).issubset(_protected_tokens(candidate))


@lru_cache(maxsize=32)
def _llm_endpoint(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/chat/completions"


def _llm_required() -> bool:
    return bool(getattr(settings, "transcription_postprocess_llm_required", False))


def _handle_llm_skip(message: str, *, extra: dict[str, object] | None = None) -> None:
    if _llm_required():
        raise TranscriptPostprocessError(message)
    logger.info(message, extra=extra)


def _call_openai_compatible_llm(text: str, *, language: str | None = None) -> str | None:
    api_key = settings.transcription_postprocess_llm_api_key
    model = settings.transcription_postprocess_llm_model
    base_url = settings.transcription_postprocess_llm_base_url
    if not api_key or not model or not base_url:
        _handle_llm_skip("Transcript LLM postprocess requires API key, model, and base URL")
        return None
    if len(text) > settings.transcription_postprocess_llm_max_chars:
        _handle_llm_skip(
            "Transcript LLM postprocess text is too long",
            extra={
                "text_length": len(text),
                "max_chars": settings.transcription_postprocess_llm_max_chars,
            },
        )
        return None

    language_hint = f" Язык транскрипции: {language}." if language else ""
    payload = {
        "model": model,
        "temperature": settings.transcription_postprocess_llm_temperature,
        "messages": [
            {
                "role": "system",
                "content": settings.transcription_postprocess_llm_system_prompt or "",
            },
            {
                "role": "user",
                "content": (
                    "Верни только исправленный текст транскрипции, без комментариев и Markdown."
                    f"{language_hint}\n\n{text}"
                ),
            },
        ],
    }
    encoded_payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    http_request = request.Request(
        _llm_endpoint(base_url),
        data=encoded_payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with request.urlopen(http_request, timeout=settings.transcription_postprocess_llm_timeout_seconds) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        logger.exception("Transcript LLM postprocess request failed")
        if _llm_required():
            raise TranscriptPostprocessError("Transcript LLM postprocess request failed") from exc
        return None

    try:
        content = response_payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        message = "Transcript LLM postprocess returned an unexpected response"
        if _llm_required():
            raise TranscriptPostprocessError(message) from exc
        logger.warning(message)
        return None

    candidate = _clean_llm_response(str(content))
    if not _is_safe_llm_result(text, candidate):
        message = "Rejected unsafe transcript LLM postprocess result"
        extra = {"source_length": len(text), "candidate_length": len(candidate)}
        if _llm_required():
            raise TranscriptPostprocessError(message)
        logger.warning(message, extra=extra)
        return None
    return candidate


def postprocess_transcript_text(text: str, *, language: str | None = None) -> str:
    if not settings.transcription_postprocess_enabled or not text.strip():
        return text

    mode = _normalize_postprocess_mode()
    corrected = text
    if mode in {"rules", "rules+llm"}:
        corrected = _apply_rule_postprocess(corrected)

    if mode in {"llm", "rules+llm", "llm+rules"}:
        llm_corrected = _call_openai_compatible_llm(corrected, language=language)
        if llm_corrected is not None:
            corrected = llm_corrected
        if mode == "llm+rules":
            corrected = _apply_rule_postprocess(corrected)

    if mode not in {"rules", "llm", "rules+llm", "llm+rules"}:
        logger.warning("Unknown transcript postprocess mode; returning original text", extra={"mode": mode})
        return text

    return corrected
