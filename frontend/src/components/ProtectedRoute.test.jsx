import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

import ProtectedRoute from "./ProtectedRoute.jsx";

const useAuthMock = vi.fn();
const routerFuture = {
  v7_relativeSplatPath: true,
  v7_startTransition: true,
};

vi.mock("../context/AuthContext", () => ({
  useAuth: () => useAuthMock(),
}));

describe("ProtectedRoute", () => {
  it("redirects anonymous users to login", () => {
    useAuthMock.mockReturnValue({ loading: false, user: null });

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/settings"]}>
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
      <MemoryRouter future={routerFuture} initialEntries={["/settings"]}>
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
