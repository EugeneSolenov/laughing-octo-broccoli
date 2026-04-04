import { Bookmark, Clock3, Search, TrendingUp, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError, apiFetch, getMediaUrl } from "../api/client";

const DEFAULT_HIGHLIGHTS = [
  { title: "Voice rooms", meta: "Live now", count: "Fresh conversations" },
  { title: "Sound notes", meta: "Creators", count: "Audio-first workflow" },
  { title: "Field recordings", meta: "Community", count: "New clips every day" },
];

const RECENT_SEARCHES_KEY = "voice-atlas:recent-searches";
const SAVED_SEARCHES_KEY = "voice-atlas:saved-searches";
const SEARCH_TABS = [
  { key: "posts", label: "Posts", icon: TrendingUp },
  { key: "people", label: "People", icon: Users },
];
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "audio",
  "clip",
  "from",
  "have",
  "into",
  "just",
  "more",
  "that",
  "their",
  "them",
  "they",
  "this",
  "voice",
  "with",
]);

function loadStoredSearches(key) {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function persistSearches(key, values) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(values.slice(0, 8)));
}

function extractTrendingTopics(items) {
  const counts = new Map();

  for (const item of items) {
    const sourceText = `${item.caption || ""} ${item.transcription_text || ""}`.toLowerCase();
    const matches = sourceText.match(/#[\p{L}\p{N}_]+|[\p{L}\p{N}][\p{L}\p{N}_-]{3,}/gu) || [];

    for (const rawWord of matches) {
      const normalized = rawWord.replace(/^[^#\p{L}\p{N}]+|[^#\p{L}\p{N}_-]+$/gu, "");
      if (!normalized || STOP_WORDS.has(normalized)) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([title, count]) => ({
      title,
      meta: count > 1 ? "Trending in voice posts" : "Emerging in voice posts",
      count: `${count} mentions`,
    }));
}

function PersonRow({ onClick, person }) {
  return (
    <button className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]" onClick={onClick} type="button">
      {person.avatar_url ? (
        <img alt={person.username} className="h-11 w-11 rounded-full object-cover" src={getMediaUrl(person.avatar_url)} />
      ) : (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1d9bf0]/15 text-sm font-bold text-x-blue">
          {person.username.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[15px] font-bold text-x-primary">{person.username}</p>
          {person.is_following ? <span className="x-pill">Following</span> : null}
        </div>
        <p className="truncate text-[13px] text-x-secondary">{person.bio || "Audio-first creator"}</p>
      </div>
    </button>
  );
}

function RailSection({ children, icon: Icon, title }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(20,22,27,0.96),rgba(11,13,16,0.96))]">
      <div className="flex items-center gap-2 px-4 pt-4">
        <Icon className="h-[18px] w-[18px] text-x-blue" />
        <h2 className="text-[20px] font-extrabold text-x-primary">{title}</h2>
      </div>
      <div className="mt-2 divide-y divide-white/5">{children}</div>
    </section>
  );
}

export default function SearchPanel({ highlights = DEFAULT_HIGHLIGHTS, mode = "rail", onClose, search, setSearch }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => (searchParams.get("searchTab") === "people" ? "people" : "posts"));
  const [people, setPeople] = useState([]);
  const [peopleError, setPeopleError] = useState("");
  const [suggestedPeople, setSuggestedPeople] = useState([]);
  const [topics, setTopics] = useState([]);
  const [topicsError, setTopicsError] = useState("");
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => loadStoredSearches(RECENT_SEARCHES_KEY));
  const [savedSearches, setSavedSearches] = useState(() => loadStoredSearches(SAVED_SEARCHES_KEY));

  useEffect(() => {
    const nextTab = searchParams.get("searchTab") === "people" ? "people" : "posts";
    setActiveTab(nextTab);
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    const loadSuggestions = async () => {
      try {
        const [topicsResult, suggestionsResult] = await Promise.all([
          apiFetch("/tweets/feed?limit=40"),
          apiFetch("/users/suggestions?limit=5"),
        ]);

        if (cancelled) {
          return;
        }

        const extractedTopics = extractTrendingTopics(topicsResult.items || []);
        setTopics(extractedTopics.length ? extractedTopics : highlights.slice(0, 6));
        setSuggestedPeople(suggestionsResult.items || []);
        setTopicsError("");
      } catch (caughtError) {
        if (!cancelled) {
          setTopics(highlights.length ? highlights : DEFAULT_HIGHLIGHTS);
          setSuggestedPeople([]);
          setTopicsError(caughtError instanceof ApiError ? caughtError.message : "Unable to load discovery data.");
        }
      }
    };

    void loadSuggestions();

    return () => {
      cancelled = true;
    };
  }, [highlights]);

  useEffect(() => {
    if (!search.trim() || activeTab !== "people") {
      setPeople([]);
      setPeopleError("");
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setLoadingPeople(true);
        const result = await apiFetch(`/users/search?q=${encodeURIComponent(search.trim())}&limit=8`);
        if (!cancelled) {
          setPeople(result.items || []);
          setPeopleError("");
        }
      } catch (caughtError) {
        if (!cancelled) {
          setPeople([]);
          setPeopleError(caughtError instanceof ApiError ? caughtError.message : "Unable to search people.");
        }
      } finally {
        if (!cancelled) {
          setLoadingPeople(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTab, search]);

  const normalizedTopics = useMemo(() => (topics.length ? topics : highlights.length ? highlights : DEFAULT_HIGHLIGHTS), [highlights, topics]);

  const commitSearch = (value) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    const nextRecents = [normalized, ...recentSearches.filter((item) => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 6);
    setRecentSearches(nextRecents);
    persistSearches(RECENT_SEARCHES_KEY, nextRecents);
  };

  const toggleSavedSearch = () => {
    const normalized = search.trim();
    if (!normalized) {
      return;
    }
    const exists = savedSearches.some((item) => item.toLowerCase() === normalized.toLowerCase());
    const nextSaved = exists
      ? savedSearches.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
      : [normalized, ...savedSearches].slice(0, 6);
    setSavedSearches(nextSaved);
    persistSearches(SAVED_SEARCHES_KEY, nextSaved);
  };

  const updateActiveTab = (nextTab) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "people") {
      nextParams.set("searchTab", "people");
    } else {
      nextParams.delete("searchTab");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const openProfile = (profileId) => {
    navigate(`/profile/${profileId}`);
    onClose?.();
  };

  return (
    <aside className="space-y-4">
      <div className="sticky top-0 z-10 rounded-b-[28px] bg-black/85 py-2 backdrop-blur-md">
        <label className="relative block" htmlFor="global-search-input">
          <span className="sr-only" id="global-search-label">
            Search posts and people
          </span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-x-secondary" />
          <input
            aria-labelledby="global-search-label"
            className="x-input pl-11"
            id="global-search-input"
            onBlur={() => commitSearch(search)}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitSearch(search);
              }
            }}
            placeholder="Search clips, people, topics"
            type="search"
            value={search}
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {SEARCH_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                className={[
                  "flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[14px] font-semibold transition",
                  active ? "bg-x-blue text-white" : "bg-white/[0.04] text-x-secondary hover:bg-white/[0.08] hover:text-x-primary",
                ].join(" ")}
                key={tab.key}
                onClick={() => updateActiveTab(tab.key)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[13px] font-medium text-x-secondary transition hover:border-white/15 hover:text-x-primary"
            onClick={toggleSavedSearch}
            type="button"
          >
            <Bookmark className="h-3.5 w-3.5" />
            {savedSearches.some((item) => item.toLowerCase() === search.trim().toLowerCase()) ? "Saved" : "Save search"}
          </button>
          {mode === "sheet" ? (
            <button className="text-[14px] font-semibold text-x-blue" onClick={onClose} type="button">
              Close
            </button>
          ) : null}
        </div>
      </div>

      {activeTab === "people" ? (
        <RailSection icon={Users} title="People to hear from">
          {loadingPeople ? (
            <div className="px-4 py-6 text-[14px] text-x-secondary">Looking for people...</div>
          ) : peopleError ? (
            <div className="px-4 py-6 text-[14px] text-red-100">{peopleError}</div>
          ) : people.length ? (
            people.map((person) => <PersonRow key={person.id} onClick={() => openProfile(person.id)} person={person} />)
          ) : suggestedPeople.length ? (
            suggestedPeople.map((person) => <PersonRow key={person.id} onClick={() => openProfile(person.id)} person={person} />)
          ) : (
            <div className="px-4 py-6 text-[14px] text-x-secondary">Start typing to find creators and listeners.</div>
          )}
        </RailSection>
      ) : (
        <>
          <RailSection icon={TrendingUp} title="Trending topics">
            {normalizedTopics.map((item) => (
              <button
                className="block w-full px-4 py-3 text-left transition hover:bg-white/[0.03]"
                key={`${item.title}-${item.meta}`}
                onClick={() => {
                  setSearch(item.title);
                  commitSearch(item.title);
                }}
                type="button"
              >
                <p className="text-[13px] text-x-secondary">{item.meta}</p>
                <p className="mt-0.5 text-[15px] font-bold text-x-primary">{item.title}</p>
                <p className="mt-0.5 text-[13px] text-x-secondary">{item.count}</p>
              </button>
            ))}
            {topicsError ? <div className="px-4 py-4 text-[13px] text-red-100">{topicsError}</div> : null}
          </RailSection>

          <RailSection icon={Users} title="Suggested people">
            {suggestedPeople.length ? (
              suggestedPeople.map((person) => <PersonRow key={person.id} onClick={() => openProfile(person.id)} person={person} />)
            ) : (
              <div className="px-4 py-4 text-[14px] text-x-secondary">Suggestions refresh from the live network as new creators post.</div>
            )}
          </RailSection>

          <RailSection icon={Clock3} title="Recent searches">
            {recentSearches.length ? (
              recentSearches.map((item) => (
                <button
                  className="block w-full px-4 py-3 text-left text-[15px] text-x-primary transition hover:bg-white/[0.03]"
                  key={item}
                  onClick={() => setSearch(item)}
                  type="button"
                >
                  {item}
                </button>
              ))
            ) : (
              <div className="px-4 py-4 text-[14px] text-x-secondary">Searches you make will show up here.</div>
            )}
          </RailSection>

          <RailSection icon={Bookmark} title="Saved searches">
            {savedSearches.length ? (
              savedSearches.map((item) => (
                <button
                  className="block w-full px-4 py-3 text-left text-[15px] text-x-primary transition hover:bg-white/[0.03]"
                  key={item}
                  onClick={() => setSearch(item)}
                  type="button"
                >
                  {item}
                </button>
              ))
            ) : (
              <div className="px-4 py-4 text-[14px] text-x-secondary">Pin searches you want to revisit later.</div>
            )}
          </RailSection>
        </>
      )}
    </aside>
  );
}
