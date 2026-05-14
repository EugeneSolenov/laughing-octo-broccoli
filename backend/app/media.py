from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


class MediaProcessingError(RuntimeError):
    pass


def _binary_path(binary_name: str) -> str:
    resolved_path = shutil.which(binary_name)
    if resolved_path is None:
        raise MediaProcessingError(f"{binary_name} is required for audio processing.")
    return resolved_path


def ffmpeg_path() -> str:
    return _binary_path("ffmpeg")


def ffprobe_path() -> str:
    return _binary_path("ffprobe")


def _build_audio_enhancement_filter() -> str | None:
    if not settings.audio_enhancement_enabled:
        return None

    filters: list[str] = []
    if settings.audio_highpass_hz > 0:
        filters.append(f"highpass=f={settings.audio_highpass_hz}")
    if settings.audio_lowpass_hz > 0:
        filters.append(f"lowpass=f={settings.audio_lowpass_hz}")
    if settings.audio_noise_reduction_enabled:
        filters.append("afftdn=nf=-25")
    if settings.audio_loudnorm_enabled:
        filters.append(
            "loudnorm="
            f"I={settings.audio_loudnorm_i}:"
            f"TP={settings.audio_loudnorm_tp}:"
            f"LRA={settings.audio_loudnorm_lra}"
        )
    return ",".join(filters) or None


def _normalize_audio_command(source_path: Path, normalized_path: Path, audio_filter: str | None) -> list[str]:
    command = [
        ffmpeg_path(),
        "-y",
        "-i",
        str(source_path),
        "-vn",
    ]
    if audio_filter:
        command.extend(["-af", audio_filter])
    command.extend(
        [
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(normalized_path),
        ]
    )
    return command


def _run_normalize_audio_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        check=False,
        text=True,
        timeout=settings.audio_ffmpeg_timeout_seconds,
    )


def normalize_audio_for_whisper(source_path: Path) -> Path:
    normalized_path = source_path.with_suffix(".whisper.wav")
    audio_filter = _build_audio_enhancement_filter()
    completed = _run_normalize_audio_command(
        _normalize_audio_command(source_path, normalized_path, audio_filter)
    )
    if completed.returncode != 0 and audio_filter:
        logger.warning(
            "ffmpeg audio enhancement failed, retrying without filters",
            extra={"source_path": str(source_path), "stderr": completed.stderr.strip()},
        )
        completed = _run_normalize_audio_command(_normalize_audio_command(source_path, normalized_path, None))

    if completed.returncode != 0:
        raise MediaProcessingError(f"ffmpeg failed to normalize audio: {completed.stderr.strip()}")
    return normalized_path


def trim_audio_clip(source_path: Path, *, start_seconds: float | None, end_seconds: float | None) -> Path:
    if start_seconds is None and end_seconds is None:
        return source_path

    trim_start = max(0.0, start_seconds or 0.0)
    if end_seconds is not None and end_seconds <= trim_start:
        raise MediaProcessingError("Trim end must be greater than trim start.")

    trimmed_path = source_path.with_suffix(f".trim{source_path.suffix}")
    command = [ffmpeg_path(), "-y", "-i", str(source_path)]
    if start_seconds is not None:
        command.extend(["-ss", f"{trim_start:.3f}"])
    if end_seconds is not None:
        command.extend(["-to", f"{end_seconds:.3f}"])
    command.append(str(trimmed_path))

    completed = subprocess.run(
        command,
        capture_output=True,
        check=False,
        text=True,
        timeout=120,
    )
    if completed.returncode != 0:
        raise MediaProcessingError(f"ffmpeg failed to trim audio: {completed.stderr.strip()}")
    source_path.unlink(missing_ok=True)
    return trimmed_path


def _coerce_duration(value: object) -> float | None:
    if value in (None, "", "N/A"):
        return None

    try:
        duration = float(value)
    except (TypeError, ValueError):
        return None

    return duration if duration >= 0 else None


def _probe_audio_duration_once(source_path: Path) -> float | None:
    completed = subprocess.run(
        [
            ffprobe_path(),
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=duration",
            "-of",
            "json",
            str(source_path),
        ],
        capture_output=True,
        check=False,
        text=True,
        timeout=60,
    )
    if completed.returncode != 0:
        raise MediaProcessingError(f"ffprobe failed to inspect audio: {completed.stderr.strip()}")

    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        return _coerce_duration(completed.stdout.strip())

    format_duration = _coerce_duration(payload.get("format", {}).get("duration"))
    if format_duration is not None:
        return format_duration

    for stream in payload.get("streams", []):
        stream_duration = _coerce_duration(stream.get("duration"))
        if stream_duration is not None:
            return stream_duration

    return None


def _probe_audio_duration_with_ffmpeg(source_path: Path) -> float | None:
    completed = subprocess.run(
        [
            ffmpeg_path(),
            "-i",
            str(source_path),
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        check=False,
        text=True,
        timeout=60,
    )

    match = re.search(r"Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)", completed.stderr or "")
    if not match:
        return None

    hours = int(match.group(1))
    minutes = int(match.group(2))
    seconds = float(match.group(3))
    return (hours * 3600) + (minutes * 60) + seconds


def probe_audio_duration(source_path: Path) -> float:
    duration = _probe_audio_duration_once(source_path)
    if duration is not None:
        return duration

    logger.warning("ffprobe returned no duration, retrying via decoded wav", extra={"source_path": str(source_path)})

    normalized_path: Path | None = None
    try:
        normalized_path = normalize_audio_for_whisper(source_path)
        fallback_duration = _probe_audio_duration_once(normalized_path)
        if fallback_duration is not None:
            return fallback_duration
        ffmpeg_duration = _probe_audio_duration_with_ffmpeg(normalized_path)
        if ffmpeg_duration is not None:
            return ffmpeg_duration
    finally:
        if normalized_path is not None:
            normalized_path.unlink(missing_ok=True)

    ffmpeg_duration = _probe_audio_duration_with_ffmpeg(source_path)
    if ffmpeg_duration is not None:
        return ffmpeg_duration

    raise MediaProcessingError("Unable to determine audio duration.")
