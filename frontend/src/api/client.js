const DEFAULT_ORIGIN = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_ERROR_DETAIL = "Invalid CSRF token.";
const VALIDATION_SCOPE_SEGMENTS = new Set(["body", "query", "path", "header", "cookie"]);
const DETAIL_MESSAGE_MAP = {
  "Audio is required for a new post.": "Для новой записи нужно добавить аудио.",
  "Comment text is required.": "Введите текст комментария.",
  "Invalid CSRF token.": "Сессия устарела. Повторите действие ещё раз.",
  "Only OGG, WebM, and WAV audio uploads are supported.": "Поддерживаются только аудиофайлы OGG, WebM и WAV.",
  "Only MP3, M4A, OGG, WebM, and WAV audio uploads are supported.": "Поддерживаются аудиофайлы MP3, M4A, OGG, WebM и WAV.",
  "Trim end must be greater than trim start.": "Конец обрезки должен быть позже начала.",
  "Unable to determine audio duration.": "Не удалось определить длительность аудио. Попробуйте загрузить MP3, M4A, WAV, OGG или WebM без повреждений.",
};
const FIELD_LABELS = {
  audio: "Аудио",
  bio: "Описание",
  caption: "Текст записи",
  current_password: "Текущий пароль",
  details: "Подробности",
  email: "Email",
  new_password: "Новый пароль",
  password: "Пароль",
  username: "Имя пользователя",
};

function isAbsoluteUrl(value) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function inferBackendOrigin() {
  if (!isAbsoluteUrl(API_BASE_URL)) {
    return "";
  }

  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return "";
  }
}

const BACKEND_ORIGIN = import.meta.env.VITE_BACKEND_ORIGIN || inferBackendOrigin() || DEFAULT_ORIGIN;

function readCookie(name) {
  if (typeof document === "undefined") {
    return "";
  }

  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : "";
}

function resolveApiUrl(path) {
  if (isAbsoluteUrl(path)) {
    return path;
  }

  if (isAbsoluteUrl(API_BASE_URL)) {
    return joinUrl(API_BASE_URL, path);
  }

  return joinUrl(API_BASE_URL, path);
}

function isCsrfBootstrapPath(path) {
  try {
    const url = new URL(resolveApiUrl(path), DEFAULT_ORIGIN);
    return url.pathname.endsWith("/auth/csrf");
  } catch {
    return false;
  }
}

async function performRequest(path, options, headers) {
  try {
    return await fetch(resolveApiUrl(path), {
      credentials: "include",
      ...options,
      headers,
    });
  } catch {
    throw new ApiError("Ошибка сети. Проверьте подключение и попробуйте снова.", 0, null);
  }
}

async function parseResponse(response) {
  if (response.status === 204) {
    return null;
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  return isJson ? response.json() : null;
}

function toSentence(text) {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function humanizeFieldLabel(loc) {
  if (!Array.isArray(loc)) {
    return "";
  }

  const segment = [...loc]
    .reverse()
    .find((item) => typeof item === "string" && !VALIDATION_SCOPE_SEGMENTS.has(item));

  if (!segment) {
    return "";
  }

  if (FIELD_LABELS[segment]) {
    return FIELD_LABELS[segment];
  }

  return segment
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValidationIssue(issue) {
  if (!issue || typeof issue !== "object") {
    return "";
  }

  const fieldLabel = humanizeFieldLabel(issue.loc);
  const rawMessage = typeof issue.msg === "string" ? issue.msg.trim() : "";

  if (issue.type === "missing") {
    return `${fieldLabel || "Поле"} обязательно.`;
  }

  if (issue.type === "string_too_short" && issue.ctx?.min_length) {
    return `${fieldLabel || "Значение"}: минимум ${issue.ctx.min_length} символов.`;
  }

  if (issue.type === "string_too_long" && issue.ctx?.max_length) {
    return `${fieldLabel || "Значение"}: максимум ${issue.ctx.max_length} символов.`;
  }

  if (issue.type === "string_pattern_mismatch") {
    if (fieldLabel === "Имя пользователя") {
      return "Имя пользователя может содержать только латинские буквы, цифры и знак подчеркивания.";
    }
    return `${fieldLabel || "Значение"} имеет неверный формат.`;
  }

  if (fieldLabel === "Email" && /valid email/i.test(rawMessage)) {
    return "Укажите корректный адрес электронной почты.";
  }

  if (fieldLabel && rawMessage) {
    return `${fieldLabel}: ${toSentence(rawMessage)}`;
  }

  return toSentence(rawMessage);
}

function formatApiErrorMessage(payload, fallbackMessage) {
  if (typeof payload?.detail === "string" && payload.detail.trim()) {
    return DETAIL_MESSAGE_MAP[payload.detail.trim()] || payload.detail.trim();
  }

  if (Array.isArray(payload?.detail)) {
    const issues = [...new Set(payload.detail.map(formatValidationIssue).filter(Boolean))];
    if (issues.length) {
      return issues.join(" ");
    }
  }

  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  return fallbackMessage;
}

export async function ensureCsrfToken({ force = false } = {}) {
  const existingToken = readCookie(CSRF_COOKIE_NAME);
  if (existingToken && !force) {
    return existingToken;
  }

  const response = await performRequest("/auth/csrf", { method: "GET" }, { Accept: "application/json" });
  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new ApiError(formatApiErrorMessage(payload, "Не удалось подготовить безопасную сессию."), response.status, payload);
  }

  return readCookie(CSRF_COOKIE_NAME) || payload?.csrf_token || "";
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch(path, options = {}, internalOptions = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = {
    Accept: "application/json",
    ...(options.headers ?? {}),
  };

  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
  }

  if (!SAFE_METHODS.has(method) && !isCsrfBootstrapPath(path)) {
    let csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (!csrfToken) {
      csrfToken = await ensureCsrfToken();
    }
    if (csrfToken) {
      headers[CSRF_HEADER_NAME] = csrfToken;
    }
  }

  const response = await performRequest(path, options, headers);
  const payload = await parseResponse(response);

  if (!response.ok) {
    if (
      !internalOptions.retriedAfterCsrfRefresh &&
      !SAFE_METHODS.has(method) &&
      !isCsrfBootstrapPath(path) &&
      response.status === 403 &&
      payload?.detail === CSRF_ERROR_DETAIL
    ) {
      await ensureCsrfToken({ force: true });
      return apiFetch(path, options, { ...internalOptions, retriedAfterCsrfRefresh: true });
    }

    throw new ApiError(formatApiErrorMessage(payload, "Запрос завершился ошибкой."), response.status, payload);
  }

  return payload;
}

export function createEventSource(path) {
  const resolvedPath = resolveApiUrl(path);
  const url = isAbsoluteUrl(resolvedPath) ? resolvedPath : new URL(resolvedPath, BACKEND_ORIGIN).toString();

  return new EventSource(url, { withCredentials: true });
}

export function getMediaUrl(path) {
  if (!path) {
    return "";
  }
  if (isAbsoluteUrl(path)) {
    return path;
  }
  return new URL(path, BACKEND_ORIGIN).toString();
}
