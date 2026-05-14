import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

import SearchPanel from "./SearchPanel.jsx";

const routerFuture = {
  v7_relativeSplatPath: true,
  v7_startTransition: true,
};

const apiFetchMock = vi.fn(async (path) => {
  if (path === "/tweets/feed?limit=40") {
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

  if (path.startsWith("/tweets/feed?q=")) {
    return {
      items: [
        {
          id: 11,
          caption: "Morning update from the studio",
          transcription_text: "Morning update from the studio",
          user: { id: 7, username: "cassetteclub", avatar_url: "" },
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
      <MemoryRouter future={routerFuture} initialEntries={["/?searchTab=people"]}>
        <Routes>
          <Route element={<SearchPanel search="" setSearch={setSearch} />} path="/" />
          <Route element={<div>profile page</div>} path="/profile/:profileId" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("searchbox", { name: /поиск по записям и людям/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Люди" })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    fireEvent.click(screen.getByText("alice"));

    await waitFor(() => expect(screen.getByText("profile page")).toBeInTheDocument());
  });

  it("shows post search results after the debounce and routes to the thread page", async () => {
    function SearchHarness() {
      const [search, setSearch] = useState("");
      return <SearchPanel search={search} setSearch={setSearch} />;
    }

    render(
      <MemoryRouter future={routerFuture} initialEntries={["/"]}>
        <Routes>
          <Route element={<SearchHarness />} path="/" />
          <Route element={<div>thread page</div>} path="/post/:postId" />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /поиск по записям и людям/i }), { target: { value: "morning" } });

    await waitFor(() => expect(screen.getByText("Morning update from the studio")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Открыть запись"));

    await waitFor(() => expect(screen.getByText("thread page")).toBeInTheDocument());
  });
});
