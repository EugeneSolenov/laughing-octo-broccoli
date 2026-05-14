from __future__ import annotations

import logging
import re
from functools import lru_cache

from app.config import settings

logger = logging.getLogger(__name__)

_CYRILLIC_RE = re.compile(r"[\u0400-\u04FF]")
_REPLACEMENT_SEPARATOR_RE = re.compile(r"\s*(?:=>|=)\s*")
_WORD_BOUNDARY_CHARS = r"A-Za-z\u0400-\u04FF0-9_"
_PROTECTED_PREFIX_CHARS = rf"{_WORD_BOUNDARY_CHARS}@#:/\."
_PROTECTED_SUFFIX_CHARS = rf"{_WORD_BOUNDARY_CHARS}:/\."


@lru_cache(maxsize=32)
def _parse_replacements(raw_replacements: str) -> tuple[tuple[str, str], ...]:
    replacements: list[tuple[str, str]] = []
    for item in raw_replacements.replace("\n", ";").split(";"):
        normalized_item = item.strip()
        if not normalized_item:
            continue

        parts = _REPLACEMENT_SEPARATOR_RE.split(normalized_item, maxsplit=1)
        if len(parts) != 2:
            logger.warning("Skipping malformed transcript replacement", extra={"replacement": normalized_item})
            continue

        source, target = (part.strip() for part in parts)
        if not source or not target:
            logger.warning("Skipping incomplete transcript replacement", extra={"replacement": normalized_item})
            continue
        replacements.append((source, target))

    return tuple(sorted(replacements, key=lambda replacement: len(replacement[0]), reverse=True))


def _replacement_pattern(source: str) -> re.Pattern[str]:
    escaped_source = re.escape(source)
    if source[0].isalnum() or _CYRILLIC_RE.match(source[0]):
        escaped_source = rf"(?<![{_PROTECTED_PREFIX_CHARS}]){escaped_source}"
    if source[-1].isalnum() or _CYRILLIC_RE.match(source[-1]):
        escaped_source = rf"{escaped_source}(?![{_PROTECTED_SUFFIX_CHARS}])"
    return re.compile(escaped_source, re.IGNORECASE)


def _apply_replacement_case(source: str, target: str) -> str:
    if source.isupper():
        return target.upper()
    if source[:1].isupper():
        return target[:1].upper() + target[1:]
    return target


def apply_transcript_replacements(text: str, *, raw_replacements: str | None = None) -> str:
    replacements_source = settings.transcription_replacements if raw_replacements is None else raw_replacements
    if not replacements_source.strip():
        return text

    corrected_text = text
    for source, target in _parse_replacements(replacements_source):
        pattern = _replacement_pattern(source)
        corrected_text = pattern.sub(lambda match: _apply_replacement_case(match.group(0), target), corrected_text)
    return corrected_text
