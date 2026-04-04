const DEFAULT_ORIGIN = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const BACKEND_ORIGIN = import.meta.env.VITE_BACKEND_ORIGIN || DEFAULT_ORIGIN;
const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "X-CSRF-Token";

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
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
    return `${API_BASE_URL}${path}`;
  }

  return `${API_BASE_URL}${path}`;
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch(path, options = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = {
    Accept: "application/json",
    ...(options.headers ?? {}),
  };

  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) {
      headers[CSRF_HEADER_NAME] = csrfToken;
    }
  }

  let response;
  try {
    response = await fetch(resolveApiUrl(path), {
      credentials: "include",
      ...options,
      headers,
    });
  } catch {
    throw new ApiError("Network error. Check your connection and try again.", 0, null);
  }

  if (response.status === 204) {
    return null;
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(payload?.detail ?? "Request failed.", response.status, payload);
  }

  return payload;
}

export function createEventSource(path) {
  const resolvedPath = resolveApiUrl(path);
  const url =
    resolvedPath.startsWith("http://") || resolvedPath.startsWith("https://")
      ? resolvedPath
      : new URL(resolvedPath, BACKEND_ORIGIN).toString();

  return new EventSource(url, { withCredentials: true });
}

export function getMediaUrl(path) {
  if (!path) {
    return "";
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return new URL(path, BACKEND_ORIGIN).toString();
}
