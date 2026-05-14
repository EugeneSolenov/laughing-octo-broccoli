import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

import { AuthPage } from "./App.jsx";

const useAuthMock = vi.fn();
const routerFuture = {
  v7_relativeSplatPath: true,
  v7_startTransition: true,
};

vi.mock("./context/AuthContext.jsx", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("./context/ToastContext.jsx", () => ({
  useToast: () => vi.fn(),
}));

vi.mock("./api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, details) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.details = details;
    }
  },
  apiFetch: vi.fn(),
  createEventSource: vi.fn(),
  getMediaUrl: (value) => value,
}));

describe("AuthPage", () => {
  it.each(["login", "register"])("toggles password visibility on %s", async (mode) => {
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      user: null,
    });

    const user = userEvent.setup();

    render(
      <MemoryRouter future={routerFuture} initialEntries={[`/${mode}`]}>
        <Routes>
          <Route element={<AuthPage mode={mode} />} path={`/${mode}`} />
        </Routes>
      </MemoryRouter>,
    );

    const passwordInput = screen.getByPlaceholderText("Минимум 8 символов");
    expect(passwordInput).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Показать пароль" }));
    expect(passwordInput).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Скрыть пароль" }));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("returns authenticated users to the original protected path", async () => {
    useAuthMock.mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      user: { id: 1, role: "admin", username: "adminpilot" },
    });

    render(
      <MemoryRouter future={routerFuture} initialEntries={[{ pathname: "/login", state: { from: "/admin" } }]}>
        <Routes>
          <Route element={<AuthPage mode="login" />} path="/login" />
          <Route element={<div>admin dashboard</div>} path="/admin" />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("admin dashboard")).toBeInTheDocument();
  });
});
