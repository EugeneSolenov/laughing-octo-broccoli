from __future__ import annotations

from app import replacements


def test_apply_transcript_replacements_preserves_protected_tokens(monkeypatch):
    monkeypatch.setattr(
        replacements.settings,
        "transcription_replacements",
        "ко цену=катсцену;им хокглавная=их главная",
        raising=False,
    )

    corrected = replacements.apply_transcript_replacements(
        "Ко цену показали, и это им хокглавная трагедия. #ко @ко https://example.com/ко"
    )

    assert corrected == "Катсцену показали, и это их главная трагедия. #ко @ко https://example.com/ко"


def test_apply_transcript_replacements_can_be_disabled(monkeypatch):
    monkeypatch.setattr(replacements.settings, "transcription_replacements", "", raising=False)

    assert replacements.apply_transcript_replacements("ко цену") == "ко цену"
