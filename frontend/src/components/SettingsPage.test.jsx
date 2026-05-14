import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import SettingsPage from "./SettingsPage.jsx";

const routerFuture = {
  v7_relativeSplatPath: true,
  v7_startTransition: true,
};

const apiFetchMock = vi.fn();
const navigateMock = vi.fn();
const logoutEverywhereMock = vi.fn();
const clearSessionMock = vi.fn();
const showToastMock = vi.fn();
const updateProfileMock = vi.fn();
const confirmMock = vi.fn();

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, details) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.details = details;
    }
  },
  apiFetch: (...args) => apiFetchMock(...args),
  getMediaUrl: (value) => value,
}));

vi.mock("../context/AuthContext.jsx", () => ({
  useAuth: () => ({
    clearSession: clearSessionMock,
    logoutEverywhere: logoutEverywhereMock,
    updateProfile: updateProfileMock,
    user: {
      id: 1,
      username: "voicepilot",
      role: "user",
      avatar_url: "",
      bio: "Audio diarist",
    },
  }),
}));

vi.mock("../context/ToastContext.jsx", () => ({
  useToast: () => showToastMock,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function buildSession(id, overrides = {}) {
  return {
    id,
    current: id === "current-session",
    created_at: "2026-04-21T09:00:00Z",
    last_seen_at: "2026-04-21T10:00:00Z",
    user_agent: "Chrome on Windows",
    ip_address: "127.0.0.1",
    ...overrides,
  };
}

describe("SettingsPage", () => {
  beforeEach(() => {
    apiFetchMock.mockImplementation((path) => {
      if (path === "/settings/preferences") {
        return Promise.resolve({
          discoverable: true,
          notifications_enabled: true,
        });
      }
      if (path === "/auth/sessions") {
        return Promise.resolve({
          items: [buildSession("current-session")],
        });
      }
      if (path === "/auth/change-password") {
        return Promise.resolve({ detail: "Пароль обновлён." });
      }
      throw new Error(`Unexpected apiFetch call: ${path}`);
    });
    navigateMock.mockReset();
    logoutEverywhereMock.mockReset();
    clearSessionMock.mockReset();
    showToastMock.mockReset();
    updateProfileMock.mockReset();
    confirmMock.mockReset();
    confirmMock.mockReturnValue(true);
    vi.spyOn(window, "confirm").mockImplementation(confirmMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs out all devices through the auth context and redirects to login", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter future={routerFuture}>
        <SettingsPage />
      </MemoryRouter>,
    );

    await screen.findByText("Текущая");

    await user.click(screen.getByRole("button", { name: /выйти на всех устройствах/i }));
    await user.click(await screen.findByRole("button", { name: /выйти везде/i }));

    await waitFor(() => {
      expect(logoutEverywhereMock).toHaveBeenCalledTimes(1);
    });
    expect(navigateMock).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("clears the local auth state after a password change", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter future={routerFuture}>
        <SettingsPage />
      </MemoryRouter>,
    );

    await screen.findByText("Текущая");

    await user.type(screen.getByLabelText(/текущий пароль/i, { selector: "input" }), "SuperSecret123!");
    await user.type(screen.getByLabelText(/новый пароль/i, { selector: "input" }), "EvenStronger456!");
    await user.click(screen.getByRole("button", { name: /обновить пароль/i }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/auth/change-password", expect.any(Object));
    });
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith("/login", { replace: true });
    expect(showToastMock).toHaveBeenCalledWith("Пароль обновлён. Войдите снова с новым паролем.", "success");
  });

  it("toggles password visibility for both password fields", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter future={routerFuture}>
        <SettingsPage />
      </MemoryRouter>,
    );

    await screen.findByText("Текущая");

    const currentPasswordInput = screen.getByLabelText(/текущий пароль/i, { selector: "input" });
    const newPasswordInput = screen.getByLabelText(/новый пароль/i, { selector: "input" });

    expect(currentPasswordInput).toHaveAttribute("type", "password");
    expect(newPasswordInput).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /показать текущий пароль/i }));
    await user.click(screen.getByRole("button", { name: /показать новый пароль/i }));

    expect(currentPasswordInput).toHaveAttribute("type", "text");
    expect(newPasswordInput).toHaveAttribute("type", "text");
  });
});
