from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

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


def normalize_audio_for_whisper(source_path: Path) -> Path:
    normalized_path = source_path.with_suffix(".whisper.wav")
    completed = subprocess.run(
        [
            ffmpeg_path(),
            "-y",
            "-i",
            str(source_path),
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(normalized_path),
        ],
        capture_output=True,
        check=False,
        text=True,
        timeout=120,
    )
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


def probe_audio_duration(source_path: Path) -> float:
    completed = subprocess.run(
        [
            ffprobe_path(),
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
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
        return float(completed.stdout.strip())
    except ValueError as exc:
        logger.exception("ffprobe returned an invalid duration", extra={"source_path": str(source_path)})
        raise MediaProcessingError("Unable to determine audio duration.") from exc
