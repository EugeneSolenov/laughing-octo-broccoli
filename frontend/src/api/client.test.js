import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "./client";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("apiFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.cookie = "csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = "csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("bootstraps a csrf cookie before unsafe requests when one is missing", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        document.cookie = "csrf_token=fresh-token; path=/";
        return jsonResponse({ csrf_token: "fresh-token", detail: "CSRF token ready." });
      })
      .mockImplementationOnce(async (_input, init) => {
        expect(init?.headers).toMatchObject({
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": "fresh-token",
        });
        return jsonResponse({ detail: "Login successful." });
      });

    const response = await apiFetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "listener@example.com", password: "Secret123!" }),
    });

    expect(response).toEqual({ detail: "Login successful." });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/api/auth/csrf"),
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/auth/login"),
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("refreshes csrf once and retries when the server rejects a stale token", async () => {
    document.cookie = "csrf_token=stale-token; path=/";

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async (_input, init) => {
        expect(init?.headers).toMatchObject({
          "X-CSRF-Token": "stale-token",
        });
        return jsonResponse({ detail: "Invalid CSRF token." }, 403);
      })
      .mockImplementationOnce(async () => {
        document.cookie = "csrf_token=fresh-token; path=/";
        return jsonResponse({ csrf_token: "fresh-token", detail: "CSRF token ready." });
      })
      .mockImplementationOnce(async (_input, init) => {
        expect(init?.headers).toMatchObject({
          "X-CSRF-Token": "fresh-token",
        });
        return jsonResponse({ detail: "Password updated." });
      });

    const response = await apiFetch("/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: "Secret123!", new_password: "Secret456!" }),
    });

    expect(response).toEqual({ detail: "Password updated." });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/api/auth/csrf"),
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      }),
    );
  });

  it("formats validation error arrays into readable text", async () => {
    document.cookie = "csrf_token=known-token; path=/";

    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () =>
      jsonResponse(
        {
          detail: [
            {
              type: "string_too_short",
              loc: ["body", "username"],
              msg: "String should have at least 3 characters",
              ctx: { min_length: 3 },
            },
            {
              type: "string_pattern_mismatch",
              loc: ["body", "username"],
              msg: "String should match pattern '^[A-Za-z0-9_]+$'",
              ctx: { pattern: "^[A-Za-z0-9_]+$" },
            },
          ],
        },
        422,
      ),
    );

    await expect(
      apiFetch("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "сы", email: "user@example.com", password: "Secret123!" }),
      }),
    ).rejects.toMatchObject({
      message:
        "Имя пользователя: минимум 3 символов. Имя пользователя может содержать только латинские буквы, цифры и знак подчеркивания.",
      status: 422,
    });
  });
});
