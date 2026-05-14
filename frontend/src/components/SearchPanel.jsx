import { Bookmark, Clock, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { apiFetch, getMediaUrl } from "../api/client";
import { buildAvatarTone, getAvatarLetter, isPlaceholderAvatarUrl } from "../utils/avatar.js";
import { buildTrendingHashtags } from "../utils/hashtags.js";

const RECENT_KEY = "va:searches:recent";
const SAVED_KEY = "va:searches:saved";
const SEARCH_DEBOUNCE_MS = 300;

const load = (key) => {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(stored) ? stored.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
};

const save = (key, values) => {
  try {
    localStorage.setItem(key, JSON.stringify(values.slice(0, 8)));
  } catch {
    // Ignore storage failures.
  }
};

function Avatar({ person, size = 40 }) {
  const avatarUrl = person.avatar_url ? getMediaUrl(person.avatar_url) : "";

  if (avatarUrl && !isPlaceholderAvatarUrl(avatarUrl)) {
    return (
      <img
        alt={person.username}
        loading="lazy"
        src={avatarUrl}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--md-sys-color-outline)" }}
      />
    );
  }

  return (
    <div className="m3-avatar" style={{ ...buildAvatarTone(person.username), width: size, height: size, fontSize: 13, fontWeight: 600 }}>
      {getAvatarLetter(person.username)}
    </div>
  );
}

function PersonRow({ onClick, person }) {
  return (
    <div className="side-list__item">
      <Link className="m3-interactive search-result-link" onClick={onClick} to={`/profile/${person.id}`}>
        <Avatar person={person} />
        <div className="search-result-copy">
          <p className="m3-title-medium search-result-name">
            {person.username}
          </p>
          <p className="m3-body-small search-result-preview">
            {person.bio || "Автор голосовых записей"}
          </p>
        </div>
      </Link>
      <Link className="m3-button m3-button-outlined m3-interactive" onClick={onClick} to={`/profile/${person.id}`}>
        Профиль
      </Link>
    </div>
  );
}

function buildPostPreview(tweet) {
  return tweet.caption?.trim() || tweet.transcription_text?.trim() || "Открыть запись.";
}

function PostRow({ onClick, tweet }) {
  return (
    <div className="side-list__item">
      <Link className="m3-interactive search-result-link" onClick={onClick} to={`/post/${tweet.id}`}>
        <Avatar person={tweet.user} />
        <div className="search-result-copy">
          <div className="search-result-meta">
            <p className="m3-title-medium search-result-name">
              {tweet.user.username}
            </p>
            <p className="m3-body-small search-result-handle">
              @{tweet.user.username.toLowerCase()}
            </p>
          </div>
          <p className="m3-body-small search-result-preview search-result-preview--multiline">
            {buildPostPreview(tweet)}
          </p>
        </div>
      </Link>
      <Link className="m3-button m3-button-outlined m3-interactive" onClick={onClick} to={`/post/${tweet.id}`}>
        Открыть запись
      </Link>
    </div>
  );
}

function Section({ title, children, description = "" }) {
  return (
    <section className="side-section">
      <div className="side-section__heading">
        <p className="m3-section-label">{title}</p>
        {description ? <p className="side-section__description">{description}</p> : null}
      </div>
      <div className="side-list">{children}</div>
    </section>
  );
}

function TopicButton({ item, onSelect }) {
  const label = `#${item.title}`;

  return (
    <button className="side-list__item side-topic-pill m3-interactive" onClick={() => onSelect(item.title)} type="button">
      <span className="side-topic-pill__main">
        <span className="side-topic-pill__hash" aria-hidden="true">#</span>
        <span className="side-topic-pill__title" title={label}>{item.title}</span>
      </span>
      <span className="side-topic-pill__count">{item.count}</span>
    </button>
  );
}

export default function SearchPanel({ mode = "rail", onClose, onInputFocusChange, search, setSearch }) {
  const isSheet = mode === "sheet";
  const isPage = mode === "page";
  const panelLabel = isSheet || isPage ? "Поиск" : "Обзор";
  const panelTitle = isSheet || isPage ? "Найти записи и людей" : "Поиск по людям и темам";
  const searchPlaceholder = isSheet || isPage ? "Ищите записи, транскрипции и людей..." : "Поиск по записям и людям...";
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("searchTab") === "people" ? "people" : "posts";
  const [people, setPeople] = useState([]);
  const [posts, setPosts] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [topics, setTopics] = useState([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [recents, setRecents] = useState(() => load(RECENT_KEY));
  const [saved, setSaved] = useState(() => load(SAVED_KEY));
  const inputRef = useRef(null);
  const trimmedSearch = search.trim();
  const inputId = isSheet ? "global-search-input-sheet" : isPage ? "global-search-input-page" : "global-search-input";

  useEffect(() => {
    if (!isSheet && !isPage) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [isPage, isSheet]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [feedData, suggestionsData] = await Promise.all([
          apiFetch("/tweets/feed?limit=40"),
          apiFetch("/users/suggestions?limit=5"),
        ]);

        if (cancelled) {
          return;
        }

        setTopics(buildTrendingHashtags(feedData.items || []));
        setSuggested(suggestionsData.items || []);
      } catch {
        if (!cancelled) {
          setTopics([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!trimmedSearch) {
      setPeople([]);
      setPosts([]);
      setLoadingPeople(false);
      setLoadingPosts(false);
      return undefined;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      if (activeTab === "people") {
        try {
          setLoadingPeople(true);
          const result = await apiFetch(`/users/search?q=${encodeURIComponent(trimmedSearch)}&limit=8`);
          if (!cancelled) {
            setPeople(result.items || []);
          }
        } catch {
          if (!cancelled) {
            setPeople([]);
          }
        } finally {
          if (!cancelled) {
            setLoadingPeople(false);
          }
        }
        return;
      }

      try {
        setLoadingPosts(true);
        const result = await apiFetch(`/tweets/feed?q=${encodeURIComponent(trimmedSearch)}&limit=8`);
        if (!cancelled) {
          setPosts(result.items || []);
        }
      } catch {
        if (!cancelled) {
          setPosts([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingPosts(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeTab, trimmedSearch]);

  const commitSearch = (value) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    const nextValues = [normalized, ...recents.filter((item) => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 6);
    setRecents(nextValues);
    save(RECENT_KEY, nextValues);
  };

  const toggleSaved = () => {
    const normalized = trimmedSearch;
    if (!normalized) {
      return;
    }

    const exists = saved.some((item) => item.toLowerCase() === normalized.toLowerCase());
    const nextValues = exists
      ? saved.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
      : [normalized, ...saved].slice(0, 6);

    setSaved(nextValues);
    save(SAVED_KEY, nextValues);
  };

  const setTab = (nextTab) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === "people") {
      nextParams.set("searchTab", "people");
    } else {
      nextParams.delete("searchTab");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const select = (value) => {
    setSearch(value);
    commitSearch(value);
    onClose?.();
  };

  const dismiss = () => {
    setSearch("");
    onInputFocusChange?.(false);
    onClose?.({ clear: true });
  };

  const handleNavigateResult = () => {
    if (trimmedSearch) {
      commitSearch(trimmedSearch);
    }
    onInputFocusChange?.(false);
    onClose?.();
  };

  return (
    <aside className="side-panel">
      <section className="side-section">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <p className="m3-section-label">{panelLabel}</p>
            <p className="m3-title-medium" style={{ marginTop: 4 }}>
              {panelTitle}
            </p>
          </div>
          {isSheet ? (
            <button aria-label="Закрыть поиск" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={dismiss} type="button">
              <X size={16} />
            </button>
          ) : null}
        </div>

        <label htmlFor={inputId} style={{ position: "relative", display: "block" }}>
          <span className="sr-only">Поиск по записям и людям</span>
          <Search
            aria-hidden="true"
            size={16}
            style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "var(--md-sys-color-on-surface-variant)" }}
          />
          <input
            aria-label="Поиск по записям и людям"
            autoComplete="off"
            className="m3-searchbar"
            data-global-search-input={mode === "sheet" ? "sheet" : "rail"}
            enterKeyHint="search"
            id={inputId}
            onBlur={() => {
              commitSearch(search);
              onInputFocusChange?.(false);
            }}
            onChange={(event) => setSearch(event.target.value)}
            onFocus={() => onInputFocusChange?.(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitSearch(search);
              }
            }}
            placeholder={searchPlaceholder}
            ref={inputRef}
            spellCheck={false}
            style={trimmedSearch ? { paddingRight: 56 } : undefined}
            type="search"
            value={search}
          />
          {trimmedSearch ? (
            <button
              aria-label="Очистить поиск"
              className="m3-icon-button m3-icon-button--outlined m3-interactive"
              onClick={() => {
                setSearch("");
                inputRef.current?.focus();
              }}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 36, height: 36 }}
              type="button"
            >
              <X size={14} />
            </button>
          ) : null}
        </label>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div aria-label="Область поиска" className="feed-switch" role="tablist">
            {[
              { key: "posts", label: "Записи" },
              { key: "people", label: "Люди" },
            ].map((tab) => (
              <button
                aria-selected={activeTab === tab.key}
                className={["feed-switch__button", activeTab === tab.key ? "is-active" : ""].join(" ")}
                key={tab.key}
                onClick={() => setTab(tab.key)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          {trimmedSearch ? (
            <button className="m3-button m3-button-outlined m3-interactive" onClick={toggleSaved} type="button">
              <Bookmark size={14} />
              {saved.some((item) => item.toLowerCase() === trimmedSearch.toLowerCase()) ? "Сохранено" : "Сохранить"}
            </button>
          ) : null}
        </div>
      </section>

      {activeTab === "people" ? (
        <Section title={trimmedSearch ? "Результаты по людям" : "Люди"}>
          {loadingPeople ? (
            <div className="side-list__item">
              <p className="m3-body-small">Идёт поиск...</p>
            </div>
          ) : people.length ? (
            people.map((person) => <PersonRow key={person.id} onClick={handleNavigateResult} person={person} />)
          ) : trimmedSearch ? (
            <div className="side-list__item">
              <p className="m3-body-small">По запросу “{trimmedSearch}” никто не найден.</p>
            </div>
          ) : suggested.length ? (
            suggested.map((person) => <PersonRow key={person.id} onClick={handleNavigateResult} person={person} />)
          ) : (
            <div className="side-list__item">
              <p className="m3-body-small">Начните вводить запрос, чтобы найти авторов.</p>
            </div>
          )}
        </Section>
      ) : trimmedSearch ? (
        <Section title="Результаты по записям">
          {loadingPosts ? (
            <div className="side-list__item">
              <p className="m3-body-small">Идёт поиск...</p>
            </div>
          ) : posts.length ? (
            posts.map((tweet) => <PostRow key={tweet.id} onClick={handleNavigateResult} tweet={tweet} />)
          ) : (
            <div className="side-list__item">
              <p className="m3-body-small">По запросу “{trimmedSearch}” записи не найдены.</p>
            </div>
          )}
        </Section>
      ) : (
        <>
          {topics.length ? (
            <Section title="Хэштеги" description="Темы из подписей к записям">
              {topics.map((item) => (
                <TopicButton item={item} key={`${item.title}-${item.count}`} onSelect={select} />
              ))}
            </Section>
          ) : null}

          {saved.length || recents.length ? (
            <Section title="Сохранённые и недавние">
              {saved.map((item) => (
                <button className="side-list__item side-memory-item m3-interactive" key={item} onClick={() => select(item)} type="button">
                  <div className="side-list__text-row">
                    <Bookmark size={16} style={{ color: "var(--md-sys-color-primary)" }} />
                    <span className="side-list__text">{item}</span>
                  </div>
                </button>
              ))}
              {recents.map((item) => (
                <button className="side-list__item side-memory-item m3-interactive" key={item} onClick={() => select(item)} type="button">
                  <div className="side-list__text-row">
                    <Clock size={16} style={{ color: "var(--md-sys-color-on-surface-variant)" }} />
                    <span className="side-list__text">{item}</span>
                  </div>
                </button>
              ))}
            </Section>
          ) : null}

          {suggested.length ? (
            <Section title="Рекомендуемые авторы">
              {suggested.map((person) => (
                <PersonRow key={person.id} onClick={handleNavigateResult} person={person} />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </aside>
  );
}
