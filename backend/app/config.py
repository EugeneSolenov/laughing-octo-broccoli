from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import model_validator, field_validator
from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Voice Twitter"
    environment: str = "development"
    debug: bool = False
    log_level: str = "INFO"
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.0

    database_url: str = "postgresql+psycopg://voice:voice@localhost:5432/voice_twitter"
    redis_url: str = "redis://localhost:6379/0"

    backend_origin: AnyHttpUrl = "http://localhost:8000"
    frontend_origin: AnyHttpUrl = "http://localhost:5173"

    secret_key: str = Field(default="change-me-in-production-please-1234", min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    access_cookie_name: str = "access_token"
    refresh_cookie_name: str = "refresh_token"
    csrf_cookie_name: str = "csrf_token"
    csrf_header_name: str = "X-CSRF-Token"
    cookie_secure: bool = True
    cookie_domain: str | None = None
    cookie_samesite: str = "lax"

    uploads_dir: str = str(REPO_DIR / "uploads")
    static_upload_prefix: str = "/uploads"
    max_upload_bytes: int = 10 * 1024 * 1024
    max_audio_seconds: int = 300
    audio_enhancement_enabled: bool = True
    audio_highpass_hz: int = 80
    audio_lowpass_hz: int = 7600
    audio_noise_reduction_enabled: bool = False
    audio_loudnorm_enabled: bool = True
    audio_loudnorm_i: float = -16.0
    audio_loudnorm_tp: float = -1.5
    audio_loudnorm_lra: float = 11.0
    audio_ffmpeg_timeout_seconds: int = 180

    storage_backend: str = "local"
    storage_bucket: str | None = None
    storage_region: str = "ru-central1"
    storage_endpoint_url: str | None = None
    storage_access_key_id: str | None = None
    storage_secret_access_key: str | None = None
    storage_presign_expire_seconds: int = 3600

    whisper_model_size: str = "dvislobokov/faster-whisper-large-v3-turbo-russian"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_cpu_threads: int = 0
    whisper_num_workers: int = 1
    whisper_language: str | None = "ru"
    whisper_task: str = "transcribe"
    whisper_beam_size: int = 7
    whisper_best_of: int = 3
    whisper_patience: float = 1.0
    whisper_length_penalty: float = 1.0
    whisper_repetition_penalty: float = 1.05
    whisper_no_repeat_ngram_size: int = 0
    whisper_temperature: float = 0.0
    whisper_temperature_fallback: str = "0.0,0.2,0.4,0.6"
    whisper_compression_ratio_threshold: float = 1.35
    whisper_log_prob_threshold: float = -1.0
    whisper_no_speech_threshold: float = 0.6
    whisper_vad_filter: bool = True
    whisper_vad_threshold: float = 0.5
    whisper_vad_min_silence_duration_ms: int = 700
    whisper_vad_min_speech_duration_ms: int = 150
    whisper_vad_speech_pad_ms: int = 400
    whisper_condition_on_previous_text: bool = False
    whisper_prompt_reset_on_temperature: float = 0.5
    whisper_initial_prompt: str | None = None
    whisper_hotwords: str | None = None
    whisper_word_timestamps: bool = False
    whisper_hallucination_silence_threshold: float | None = None
    whisper_language_detection_threshold: float = 0.7
    whisper_language_detection_segments: int = 2
    whisper_model_dir: str = str(REPO_DIR / ".cache" / "whisper")
    celery_queue_name: str = "celery"
    whisper_load_timeout_seconds: int = 600
    transcription_max_retries: int = 3
    transcription_retry_delay_seconds: int = 30
    transcription_soft_time_limit_seconds: int = 1200
    transcription_hard_time_limit_seconds: int = 1500
    transcription_replacements: str = ""
    transcription_postprocess_enabled: bool = True
    transcription_postprocess_mode: str = "rules+llm"
    transcription_postprocess_llm_required: bool = False
    transcription_postprocess_replacements: str = ""
    transcription_postprocess_capitalize_sentences: bool = True
    transcription_postprocess_llm_api_key: str | None = None
    transcription_postprocess_llm_base_url: str | None = "https://api.openai.com/v1"
    transcription_postprocess_llm_model: str | None = None
    transcription_postprocess_llm_timeout_seconds: int = 30
    transcription_postprocess_llm_max_chars: int = 5000
    transcription_postprocess_llm_temperature: float = 0.0
    transcription_postprocess_llm_system_prompt: str | None = (
        "Ты редактор ASR-транскрипций. Исправляй только очевидные ошибки распознавания, "
        "орфографию, пунктуацию и капитализацию. Не добавляй новые факты, не меняй смысл, "
        "не вырезай важные слова. Сохраняй URL, @mentions, #hashtags и формат чисел."
    )
    password_reset_expire_minutes: int = 30
    email_verification_expire_minutes: int = 60 * 24

    auth_login_rate_limit: str = "5/minute"
    auth_register_rate_limit: str = "3/minute"
    tweet_create_rate_limit: str = "10/minute"
    tweet_delete_rate_limit: str = "30/minute"

    admin_email: str = "admin@voice-tweet.com"
    admin_username: str = "admin"
    admin_password: str = "ChangeMeAdmin123!"

    @field_validator("environment", "storage_backend", "whisper_task", mode="before")
    @classmethod
    def normalize_lowercase(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator(
        "whisper_language",
        "whisper_initial_prompt",
        "whisper_hotwords",
        "whisper_hallucination_silence_threshold",
        "cookie_domain",
        "storage_bucket",
        "storage_endpoint_url",
        "sentry_dsn",
        "transcription_postprocess_llm_api_key",
        "transcription_postprocess_llm_base_url",
        "transcription_postprocess_llm_model",
        "transcription_postprocess_llm_system_prompt",
        mode="before",
    )
    @classmethod
    def empty_string_to_none(cls, value: str | None) -> str | None:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def validate_production_security(self) -> "Settings":
        if self.environment == "production" and self.secret_key == "change-me-in-production-please-1234":
            raise ValueError("SECRET_KEY must be overridden in production.")
        if self.environment == "production" and not self.cookie_secure:
            raise ValueError("COOKIE_SECURE must be enabled in production.")
        if self.environment == "production" and self.storage_backend == "local":
            raise ValueError("Local file storage is not allowed in production. Configure S3/MinIO.")
        if self.storage_backend == "s3":
            required_fields = {
                "storage_bucket": self.storage_bucket,
                "storage_access_key_id": self.storage_access_key_id,
                "storage_secret_access_key": self.storage_secret_access_key,
            }
            missing = [field_name for field_name, field_value in required_fields.items() if not field_value]
            if missing:
                raise ValueError(f"S3 storage requires: {', '.join(sorted(missing))}.")
        return self

    @property
    def uploads_path(self) -> Path:
        uploads_path = Path(self.uploads_dir)
        if uploads_path.is_absolute():
            return uploads_path
        return (BACKEND_DIR / uploads_path).resolve()

    @property
    def whisper_model_path(self) -> Path:
        model_path = Path(self.whisper_model_dir)
        if model_path.is_absolute():
            return model_path
        return (BACKEND_DIR / model_path).resolve()

    @property
    def backend_origin_value(self) -> str:
        return str(self.backend_origin).rstrip("/")

    @property
    def frontend_origin_value(self) -> str:
        return str(self.frontend_origin).rstrip("/")

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
