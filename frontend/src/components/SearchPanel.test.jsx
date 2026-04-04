import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

import SearchPanel from "./SearchPanel.jsx";

const apiFetchMock = vi.fn(async (path) => {
  if (path.startsWith("/tweets/feed")) {
    return {
      items: [
        {
          id: 1,
          caption: "Audio design systems for creators",
          transcription_text: "Audio design systems for creators",
        },
      ],
    };
  }

  if (path.startsWith("/users/suggestions")) {
    return {
      items: [{ id: 2, username: "alice", bio: "Voice designer", avatar_url: "" }],
    };
  }

  if (path.startsWith("/users/search")) {
    return {
      items: [{ id: 3, username: "bob", bio: "Podcast host", avatar_url: "" }],
    };
  }

  return { items: [] };
});

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: (...args) => apiFetchMock(...args),
  getMediaUrl: (value) => value,
}));

describe("SearchPanel", () => {
  it("uses an accessible search label and respects the people tab from the URL", async () => {
    const setSearch = vi.fn();

    render(
      <MemoryRouter initialEntries={["/?searchTab=people"]}>
        <Routes>
          <Route element={<SearchPanel search="" setSearch={setSearch} />} path="/" />
          <Route element={<div>profile page</div>} path="/profile/:profileId" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("searchbox", { name: /search posts and people/i })).toBeInTheDocument();
    expect(screen.getByText("People to hear from")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    fireEvent.click(screen.getByText("alice"));

    await waitFor(() => expect(screen.getByText("profile page")).toBeInTheDocument());
  });
});
