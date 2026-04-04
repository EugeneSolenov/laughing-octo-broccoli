from __future__ import annotations

import logging

from app.config import settings

logger = logging.getLogger(__name__)
_INITIALIZED = False


def configure_observability(*, worker: bool = False) -> None:
    global _INITIALIZED
    if _INITIALIZED or not settings.sentry_dsn:
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.celery import CeleryIntegration
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
    except Exception:
        logger.exception("Sentry SDK is not available")
        return

    integrations = [
        LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
    ]
    if worker:
        integrations.append(CeleryIntegration())
    else:
        integrations.append(FastApiIntegration())

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=integrations,
        environment=settings.environment,
        send_default_pii=False,
    )
    _INITIALIZED = True
