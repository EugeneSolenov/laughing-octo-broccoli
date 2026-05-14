from __future__ import annotations

import json

import pytest

from app import postprocess


def test_postprocess_transcript_text_can_be_disabled(monkeypatch):
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_enabled", False, raising=False)

    assert postprocess.postprocess_transcript_text("  привет   мир  ", language="ru") == "  привет   мир  "


def test_postprocess_transcript_text_applies_separate_rule_stage(monkeypatch):
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_enabled", True, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_mode", "rules", raising=False)
    monkeypatch.setattr(
        postprocess.settings,
        "transcription_postprocess_replacements",
        "\u043a\u043e \u0446\u0435\u043d\u0443=\u043a\u0430\u0442\u0441\u0446\u0435\u043d\u0443",
        raising=False,
    )
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_capitalize_sentences", True, raising=False)

    corrected = postprocess.postprocess_transcript_text(
        "\u043f\u0440\u0438\u0432\u0435\u0442   \u043c\u0438\u0440  ! \u043a\u043e \u0446\u0435\u043d\u0443",
        language="ru",
    )

    assert corrected == "\u041f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440! \u041a\u0430\u0442\u0441\u0446\u0435\u043d\u0443"


def test_postprocess_transcript_text_can_call_openai_compatible_llm(monkeypatch):
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": "\u041f\u0440\u0438\u0432\u0435\u0442, @user! https://example.com",
                            }
                        }
                    ]
                }
            ).encode("utf-8")

    def fake_urlopen(http_request, timeout):  # noqa: ANN001
        captured["url"] = http_request.full_url
        captured["timeout"] = timeout
        captured["payload"] = json.loads(http_request.data.decode("utf-8"))
        captured["authorization"] = http_request.headers["Authorization"]
        return FakeResponse()

    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_enabled", True, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_mode", "llm", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_required", False, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_api_key", "secret", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_base_url", "https://llm.example/v1", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_model", "quality-model", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_timeout_seconds", 12, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_max_chars", 5000, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_temperature", 0.0, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_system_prompt", "fix only", raising=False)
    monkeypatch.setattr(postprocess.request, "urlopen", fake_urlopen)

    corrected = postprocess.postprocess_transcript_text(
        "\u043f\u0440\u0438\u0432\u0435\u0442 @user https://example.com",
        language="ru",
    )

    assert corrected == "\u041f\u0440\u0438\u0432\u0435\u0442, @user! https://example.com"
    assert captured["url"] == "https://llm.example/v1/chat/completions"
    assert captured["timeout"] == 12
    assert captured["authorization"] == "Bearer secret"
    assert captured["payload"]["model"] == "quality-model"
    assert captured["payload"]["messages"][0]["content"] == "fix only"


def test_postprocess_transcript_text_rejects_llm_result_that_drops_protected_tokens(monkeypatch):
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return json.dumps({"choices": [{"message": {"content": "\u041f\u0440\u0438\u0432\u0435\u0442"}}]}).encode("utf-8")

    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_enabled", True, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_mode", "llm", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_required", False, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_api_key", "secret", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_base_url", "https://llm.example/v1", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_model", "quality-model", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_timeout_seconds", 12, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_max_chars", 5000, raising=False)
    monkeypatch.setattr(postprocess.request, "urlopen", lambda *args, **kwargs: FakeResponse())

    original = "\u043f\u0440\u0438\u0432\u0435\u0442 @user https://example.com"

    assert postprocess.postprocess_transcript_text(original, language="ru") == original


def test_postprocess_transcript_text_raises_when_required_llm_is_not_configured(monkeypatch):
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_enabled", True, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_mode", "rules+llm", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_required", True, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_api_key", None, raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_base_url", "https://llm.example/v1", raising=False)
    monkeypatch.setattr(postprocess.settings, "transcription_postprocess_llm_model", None, raising=False)

    with pytest.raises(postprocess.TranscriptPostprocessError):
        postprocess.postprocess_transcript_text("привет мир", language="ru")
