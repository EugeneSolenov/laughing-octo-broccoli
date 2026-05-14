from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from app import media
from app.media import MediaProcessingError


def _completed_process(
    args: list[str], *, returncode: int = 0, stdout: str = "", stderr: str = ""
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=stdout, stderr=stderr)


def test_normalize_audio_for_whisper_applies_enhancement_filters(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = tmp_path / "clip.webm"
    source_path.write_bytes(b"fake")
    seen_args: list[str] = []

    def fake_run(args, **kwargs):  # noqa: ANN001
        seen_args.extend(args)
        Path(args[-1]).write_bytes(b"wav")
        return _completed_process(args)

    monkeypatch.setattr(media, "ffmpeg_path", lambda: "ffmpeg-bin")
    monkeypatch.setattr(media.settings, "audio_enhancement_enabled", True)
    monkeypatch.setattr(media.settings, "audio_highpass_hz", 90)
    monkeypatch.setattr(media.settings, "audio_lowpass_hz", 7200)
    monkeypatch.setattr(media.settings, "audio_noise_reduction_enabled", True)
    monkeypatch.setattr(media.settings, "audio_loudnorm_enabled", True)
    monkeypatch.setattr(media.settings, "audio_loudnorm_i", -16.0)
    monkeypatch.setattr(media.settings, "audio_loudnorm_tp", -1.5)
    monkeypatch.setattr(media.settings, "audio_loudnorm_lra", 11.0)
    monkeypatch.setattr(media.subprocess, "run", fake_run)

    normalized_path = media.normalize_audio_for_whisper(source_path)

    assert normalized_path == tmp_path / "clip.whisper.wav"
    assert "-af" in seen_args
    assert seen_args[seen_args.index("-af") + 1] == (
        "highpass=f=90,lowpass=f=7200,afftdn=nf=-25,loudnorm=I=-16.0:TP=-1.5:LRA=11.0"
    )
    assert "-ar" in seen_args
    assert seen_args[seen_args.index("-ar") + 1] == "16000"
    assert "-ac" in seen_args
    assert seen_args[seen_args.index("-ac") + 1] == "1"


def test_normalize_audio_for_whisper_retries_without_filters_when_enhancement_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_path = tmp_path / "clip.webm"
    source_path.write_bytes(b"fake")
    calls: list[list[str]] = []

    def fake_run(args, **kwargs):  # noqa: ANN001
        calls.append(args)
        if "-af" in args:
            return _completed_process(args, returncode=1, stderr="bad filter")
        Path(args[-1]).write_bytes(b"wav")
        return _completed_process(args)

    monkeypatch.setattr(media, "ffmpeg_path", lambda: "ffmpeg-bin")
    monkeypatch.setattr(media.settings, "audio_enhancement_enabled", True)
    monkeypatch.setattr(media.subprocess, "run", fake_run)

    assert media.normalize_audio_for_whisper(source_path) == tmp_path / "clip.whisper.wav"
    assert len(calls) == 2
    assert "-af" in calls[0]
    assert "-af" not in calls[1]


def test_normalize_audio_for_whisper_can_skip_enhancement_filters(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = tmp_path / "clip.webm"
    source_path.write_bytes(b"fake")
    seen_args: list[str] = []

    def fake_run(args, **kwargs):  # noqa: ANN001
        seen_args.extend(args)
        Path(args[-1]).write_bytes(b"wav")
        return _completed_process(args)

    monkeypatch.setattr(media, "ffmpeg_path", lambda: "ffmpeg-bin")
    monkeypatch.setattr(media.settings, "audio_enhancement_enabled", False)
    monkeypatch.setattr(media.subprocess, "run", fake_run)

    assert media.normalize_audio_for_whisper(source_path) == tmp_path / "clip.whisper.wav"
    assert "-af" not in seen_args


def test_probe_audio_duration_uses_stream_duration_when_format_duration_is_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = tmp_path / "clip.webm"
    source_path.write_bytes(b"fake")

    def fake_run(args, **kwargs):  # noqa: ANN001
        assert args[0] == "ffprobe-bin"
        assert Path(args[-1]) == source_path
        return _completed_process(
            args,
            stdout='{"format":{"duration":"N/A"},"streams":[{"duration":"15.04"}]}',
        )

    monkeypatch.setattr(media, "ffprobe_path", lambda: "ffprobe-bin")
    monkeypatch.setattr(media.subprocess, "run", fake_run)

    assert media.probe_audio_duration(source_path) == 15.04


def test_probe_audio_duration_falls_back_to_decoded_wav_when_ffprobe_returns_na(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = tmp_path / "clip.webm"
    source_path.write_bytes(b"fake")

    def fake_run(args, **kwargs):  # noqa: ANN001
        command = args[0]
        target_path = Path(args[-1])

        if command == "ffprobe-bin":
            if target_path == source_path:
                return _completed_process(
                    args,
                    stdout='{"format":{"duration":"N/A"},"streams":[{"duration":"N/A"}]}',
                )

            assert target_path.suffix == ".wav"
            return _completed_process(
                args,
                stdout='{"format":{"duration":"12.5"},"streams":[{"duration":"12.5"}]}',
            )

        if command == "ffmpeg-bin":
            target_path.write_bytes(b"wav")
            return _completed_process(args)

        raise AssertionError(f"Unexpected command: {args}")

    monkeypatch.setattr(media, "ffprobe_path", lambda: "ffprobe-bin")
    monkeypatch.setattr(media, "ffmpeg_path", lambda: "ffmpeg-bin")
    monkeypatch.setattr(media.subprocess, "run", fake_run)

    assert media.probe_audio_duration(source_path) == 12.5


def test_probe_audio_duration_raises_when_duration_cannot_be_resolved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = tmp_path / "clip.webm"
    source_path.write_bytes(b"fake")

    def fake_run(args, **kwargs):  # noqa: ANN001
        command = args[0]
        target_path = Path(args[-1])

        if command == "ffprobe-bin":
            return _completed_process(
                args,
                stdout='{"format":{"duration":"N/A"},"streams":[{"duration":"N/A"}]}',
            )

        if command == "ffmpeg-bin":
            target_path.write_bytes(b"wav")
            return _completed_process(args)

        raise AssertionError(f"Unexpected command: {args}")

    monkeypatch.setattr(media, "ffprobe_path", lambda: "ffprobe-bin")
    monkeypatch.setattr(media, "ffmpeg_path", lambda: "ffmpeg-bin")
    monkeypatch.setattr(media.subprocess, "run", fake_run)

    with pytest.raises(MediaProcessingError, match="Unable to determine audio duration."):
        media.probe_audio_duration(source_path)


def test_probe_audio_duration_falls_back_to_ffmpeg_duration_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_path = tmp_path / "clip.webm"
    source_path.write_bytes(b"fake")

    def fake_run(args, **kwargs):  # noqa: ANN001
        command = args[0]

        if command == "ffprobe-bin":
            return _completed_process(
                args,
                stdout='{"format":{"duration":"N/A"},"streams":[{"duration":"N/A"}]}',
            )

        if command == "ffmpeg-bin":
            if args[-1] != "-":
                normalized_path = Path(args[-1])
                normalized_path.write_bytes(b"wav")
                return _completed_process(args)
            return _completed_process(args, stderr="Duration: 00:00:15.04, start: 0.000000, bitrate: 64 kb/s")

        raise AssertionError(f"Unexpected command: {args}")

    monkeypatch.setattr(media, "ffprobe_path", lambda: "ffprobe-bin")
    monkeypatch.setattr(media, "ffmpeg_path", lambda: "ffmpeg-bin")
    monkeypatch.setattr(media.subprocess, "run", fake_run)

    assert media.probe_audio_duration(source_path) == 15.04
