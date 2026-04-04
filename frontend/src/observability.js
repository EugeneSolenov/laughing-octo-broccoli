import * as Sentry from "@sentry/react";

let initialized = false;

export function initObservability() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (initialized || !dsn) {
    return;
  }

  Sentry.init({
    dsn,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0),
    environment: import.meta.env.MODE,
    integrations: [],
  });
  initialized = true;
}

export function captureClientError(error, context = {}) {
  if (!initialized) {
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}
