import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

import ProtectedRoute from "./ProtectedRoute.jsx";

const useAuthMock = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

describe("ProtectedRoute", () => {
  it("redirects anonymous users to login", () => {
    useAuthMock.mockReturnValue({ loading: false, user: null });

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route
            element={
              <ProtectedRoute roles={["user"]}>
                <div>secret settings</div>
              </ProtectedRoute>
            }
            path="/settings"
          />
          <Route element={<div>login page</div>} path="/login" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  it("renders the protected content for allowed roles", () => {
    useAuthMock.mockReturnValue({ loading: false, user: { id: 1, role: "user" } });

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route
            element={
              <ProtectedRoute roles={["user"]}>
                <div>secret settings</div>
              </ProtectedRoute>
            }
            path="/settings"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("secret settings")).toBeInTheDocument();
  });
});
