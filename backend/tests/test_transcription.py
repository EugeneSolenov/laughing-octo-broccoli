from types import SimpleNamespace

import pytest
from app import transcription


@pytest.fixture(autouse=True)
def disable_required_llm_postprocess(monkeypatch):
    monkeypatch.setattr(transcription.settings, "transcription_postprocess_enabled", False, raising=False)
    monkeypatch.setattr(transcription.settings, "transcription_postprocess_llm_required", False, raising=False)


class DummyModel:
    def __init__(self, responses):
        self.calls = []
        self.responses = responses

    def transcribe(self, file_path, **kwargs):
        language = kwargs["language"]
        self.calls.append((file_path, language, kwargs))
        response = self.responses[language]
        return iter(response["segments"]), SimpleNamespace(
            language=language, language_probability=response.get("language_probability", 1.0)
        )


def make_segment(text, no_speech_prob):
    return SimpleNamespace(text=text, no_speech_prob=no_speech_prob)


def called_paths_and_languages(model):
    return [(file_path, language) for file_path, language, _ in model.calls]


def test_transcribe_audio_prefers_russian_before_falling_back_to_english(monkeypatch):
    model = DummyModel(
        {
            "ru": {
                "segments": [make_segment("Privet", 0.91)],
            },
            "en": {
                "segments": [make_segment("Hello there", 0.08)],
            },
        }
    )

    monkeypatch.setattr(transcription, "_get_whisper_model", lambda: model)
    monkeypatch.setattr(transcription.settings, "whisper_language", None, raising=False)

    transcript = transcription.transcribe_audio("sample.wav")

    assert transcript == "Hello there"
    assert called_paths_and_languages(model) == [("sample.wav", "ru"), ("sample.wav", "en")]


def test_transcribe_audio_keeps_russian_result_when_confident(monkeypatch):
    model = DummyModel(
        {
            "ru": {
                "segments": [make_segment("\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440", 0.12)],
            },
        }
    )

    monkeypatch.setattr(transcription, "_get_whisper_model", lambda: model)
    monkeypatch.setattr(transcription.settings, "whisper_language", "ru", raising=False)

    transcript = transcription.transcribe_audio("sample.wav")

    assert transcript == "\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440"
    assert called_paths_and_languages(model) == [("sample.wav", "ru")]


def test_sanitize_transcript_removes_asr_word_artifacts_without_touching_user_tokens():
    transcript = transcription._sanitize_transcript_text(
        "\u042d\u0442\u043e "
        "\u0411\u0440\u044f-\u044f-\u044d\u043d-\u043b\u043e-\u043d\u0435-\u043b\u0438-\u043b\u0438 "
        "\u043e\u043e\u043e\u043e\u0447\u0435\u043d\u044c "
        "\u0432\u0430\u0436\u043d\u044b\u0439 \u0442\u0435\u0441\u0442 "
        "#\u0432\u0430\u0436\u043d\u043e @speaker https://example.com"
    )

    assert (
        transcript == "\u042d\u0442\u043e \u043e\u043e\u0447\u0435\u043d\u044c "
        "\u0432\u0430\u0436\u043d\u044b\u0439 \u0442\u0435\u0441\u0442 "
        "#\u0432\u0430\u0436\u043d\u043e @speaker https://example.com"
    )


def test_sanitize_transcript_preserves_short_russian_words():
    transcript = transcription._sanitize_transcript_text(
        "\u0414\u043e \u0442\u043e\u0433\u043e, \u043a\u0430\u043a \u044f "
        "\u0442\u0443\u0434\u0430 \u043f\u0440\u0438\u0448\u0435\u043b."
    )

    assert transcript == (
        "\u0414\u043e \u0442\u043e\u0433\u043e, \u043a\u0430\u043a \u044f "
        "\u0442\u0443\u0434\u0430 \u043f\u0440\u0438\u0448\u0435\u043b."
    )


def test_transcribe_audio_falls_back_when_primary_cleanup_removes_artifact(monkeypatch):
    model = DummyModel(
        {
            "ru": {
                "segments": [
                    make_segment(
                        "\u0411\u0440\u044f-\u044f-\u044d\u043d-\u043b\u043e-\u043d\u0435-\u043b\u0438-\u043b\u0438",
                        0.12,
                    )
                ],
            },
            "en": {
                "segments": [make_segment("Hello there", 0.08)],
            },
        }
    )

    monkeypatch.setattr(transcription, "_get_whisper_model", lambda: model)
    monkeypatch.setattr(transcription.settings, "whisper_language", "ru", raising=False)

    transcript = transcription.transcribe_audio("sample.wav")

    assert transcript == "Hello there"
    assert called_paths_and_languages(model) == [("sample.wav", "ru"), ("sample.wav", "en")]


def test_transcribe_audio_runs_replacements_after_sanitizing(monkeypatch):
    model = DummyModel(
        {
            "ru": {
                "segments": [make_segment("\u043f\u0440\u0435\u0432\u0435\u0442 \u043c\u0438\u0440", 0.12)],
            },
        }
    )

    monkeypatch.setattr(transcription, "_get_whisper_model", lambda: model)
    monkeypatch.setattr(transcription.settings, "whisper_language", "ru", raising=False)
    monkeypatch.setattr(
        transcription,
        "apply_transcript_replacements",
        lambda text: text.replace("\u043f\u0440\u0435\u0432\u0435\u0442", "\u043f\u0440\u0438\u0432\u0435\u0442"),
    )

    transcript = transcription.transcribe_audio("sample.wav")

    assert transcript == "\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440"
    assert called_paths_and_languages(model) == [("sample.wav", "ru")]


def test_transcribe_audio_runs_optional_postprocess_after_replacements(monkeypatch):
    model = DummyModel(
        {
            "ru": {
                "segments": [make_segment("\u043f\u0440\u0435\u0432\u0435\u0442 \u043c\u0438\u0440", 0.12)],
            },
        }
    )

    monkeypatch.setattr(transcription, "_get_whisper_model", lambda: model)
    monkeypatch.setattr(transcription.settings, "whisper_language", "ru", raising=False)
    monkeypatch.setattr(
        transcription,
        "apply_transcript_replacements",
        lambda text: text.replace("\u043f\u0440\u0435\u0432\u0435\u0442", "\u043f\u0440\u0438\u0432\u0435\u0442"),
    )
    monkeypatch.setattr(
        transcription,
        "postprocess_transcript_text",
        lambda text, *, language: text.replace("\u043c\u0438\u0440", "\u043c\u0438\u0440!"),
    )

    transcript = transcription.transcribe_audio("sample.wav")

    assert transcript == "\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440!"
    assert called_paths_and_languages(model) == [("sample.wav", "ru")]


def test_transcribe_audio_passes_quality_parameters(monkeypatch):
    model = DummyModel(
        {
            "ru": {
                "segments": [make_segment("\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440", 0.12)],
            },
        }
    )

    monkeypatch.setattr(transcription, "_get_whisper_model", lambda: model)
    monkeypatch.setattr(transcription.settings, "whisper_language", "ru", raising=False)
    monkeypatch.setattr(transcription.settings, "whisper_task", "transcribe", raising=False)
    monkeypatch.setattr(transcription.settings, "whisper_beam_size", 5, raising=False)
    monkeypatch.setattr(transcription.settings, "whisper_best_of", 3, raising=False)
    monkeypatch.setattr(transcription.settings, "whisper_patience", 1.0, raising=False)
    monkeypatch.setattr(transcription.settings, "whisper_repetition_penalty", 1.05, raising=False)
    monkeypatch.setattr(transcription.settings, "whisper_temperature_fallback", "0.0,0.2,0.4,0.6", raising=False)
    monkeypatch.setattr(transcription.settings, "whisper_vad_filter", True, raising=False)
    monkeypatch.setattr(transcription.settings, "whisper_vad_min_silence_duration_ms", 1000, raising=False)
    monkeypatch.setattr(
        transcription.settings,
        "whisper_initial_prompt",
        "\u0440\u0443\u0441\u0441\u043a\u0438\u0439 \u0442\u0435\u043a\u0441\u0442",
        raising=False,
    )
    monkeypatch.setattr(
        transcription.settings, "whisper_hotwords", "\u043a\u0430\u0442\u0441\u0446\u0435\u043d\u0430", raising=False
    )

    transcript = transcription.transcribe_audio("sample.wav")

    assert transcript == "\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440"
    kwargs = model.calls[0][2]
    assert kwargs["beam_size"] == 5
    assert kwargs["task"] == "transcribe"
    assert kwargs["best_of"] == 3
    assert kwargs["patience"] == 1.0
    assert kwargs["repetition_penalty"] == 1.05
    assert kwargs["temperature"] == [0.0, 0.2, 0.4, 0.6]
    assert kwargs["vad_parameters"]["min_silence_duration_ms"] == 1000
    assert kwargs["initial_prompt"] == "\u0440\u0443\u0441\u0441\u043a\u0438\u0439 \u0442\u0435\u043a\u0441\u0442"
    assert kwargs["hotwords"] == "\u043a\u0430\u0442\u0441\u0446\u0435\u043d\u0430"
