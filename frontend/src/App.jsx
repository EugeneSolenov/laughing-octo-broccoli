import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Bell, Eye, EyeOff, Home, LoaderCircle, Mic, Search, Shield, User } from "lucide-react";
import { startTransition, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from "react-router-dom";

import { ApiError, apiFetch, createEventSource, getMediaUrl } from "./api/client";
import AdminDashboard from "./components/AdminDashboard.jsx";
import BrandMark from "./components/BrandMark.jsx";
import NotificationSheet from "./components/NotificationSheet.jsx";
import PostCard from "./components/PostCard.jsx";
import PostComposer from "./components/PostComposer.jsx";
import PostThreadPage from "./components/PostThreadPage.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import PublicProfilePage from "./components/PublicProfilePage.jsx";
import RouteErrorBoundary from "./components/RouteErrorBoundary.jsx";
import SearchPanel from "./components/SearchPanel.jsx";
import SettingsPage from "./components/SettingsPage.jsx";
import Sidebar from "./components/Sidebar.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { useToast } from "./context/ToastContext.jsx";

const FEED_TABS = [
  { key: "for-you", label: "Для вас" },
  { key: "following", label: "Подписки" },
];

const DEFAULT_HIGHLIGHTS = [
  { title: "голосовые дневники", meta: "Слушают сейчас", count: "Новые разговоры" },
  { title: "полевые записи", meta: "Авторы", count: "Свежие клипы каждый час" },
  { title: "монтаж клипов", meta: "Процесс", count: "Запись, обрезка, публикация" },
];

const AUTH_SOUND_BARS = [48, 74, 56, 92, 68, 104, 72, 118, 64, 88, 70, 98];
const AUTH_SIGNAL_ITEMS = [
  {
    title: "Запись прямо в браузере",
    detail: "Захватывайте чистое моно-аудио в один клик и публикуйте с того же экрана.",
  },
  {
    title: "Обрезка перед публикацией",
    detail: "Подчистите начало и конец записи до того, как она появится в ленте.",
  },
  {
    title: "Комментарии рядом с постом",
    detail: "Обсуждение, транскрипция и слушатели остаются в одном месте.",
  },
];

const LIVE_REFRESH_EVENTS = new Set([
  "tweet.created",
  "tweet.deleted",
  "tweet.engagement_updated",
  "tweet.transcription_updated",
]);
const MAIN_COLUMN_SCROLL_POSITIONS = new Map();
const MAIN_COLUMN_SCROLL_STORAGE_PREFIX = "voice:main-scroll:";
const MAIN_COLUMN_PENDING_SCROLL_KEY = "voice:pending-main-scroll-key";
let lastBrowserNavigationWasPop = false;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    lastBrowserNavigationWasPop = true;
  });
}

function buildScrollStorageKey(location) {
  return `${location.pathname}${location.search}`;
}

function readMainColumnScrollPosition(key) {
  if (MAIN_COLUMN_SCROLL_POSITIONS.has(key)) {
    return MAIN_COLUMN_SCROLL_POSITIONS.get(key);
  }

  if (typeof window === "undefined") {
    return undefined;
  }

  const storedValue = window.sessionStorage.getItem(`${MAIN_COLUMN_SCROLL_STORAGE_PREFIX}${key}`);
  const parsedValue = Number(storedValue);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function writeMainColumnScrollPosition(key, scrollTop) {
  MAIN_COLUMN_SCROLL_POSITIONS.set(key, scrollTop);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(`${MAIN_COLUMN_SCROLL_STORAGE_PREFIX}${key}`, String(scrollTop));
  }
}

function readPendingMainColumnScrollKey() {
  if (typeof window === "undefined") {
    return "";
  }
  return window.sessionStorage.getItem(MAIN_COLUMN_PENDING_SCROLL_KEY) || "";
}

function writePendingMainColumnScrollKey(key) {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(MAIN_COLUMN_PENDING_SCROLL_KEY, key);
  }
}

function clearPendingMainColumnScrollKey(key) {
  if (typeof window !== "undefined" && readPendingMainColumnScrollKey() === key) {
    window.sessionStorage.removeItem(MAIN_COLUMN_PENDING_SCROLL_KEY);
  }
}

function resolvePostAuthPath(candidatePath) {
  if (
    typeof candidatePath === "string" &&
    candidatePath.length > 0 &&
    candidatePath !== "/login" &&
    candidatePath !== "/register"
  ) {
    return candidatePath;
  }

  return "/";
}

function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  useEffect(() => {
    const handleVisibilityChange = () => setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return isVisible;
}

function useNetworkToasts() {
  const showToast = useToast();

  useEffect(() => {
    const handleOnline = () => showToast("Соединение восстановлено.", "success");
    const handleOffline = () => showToast("Вы офлайн. Некоторые действия могут не сработать.", "info");

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [showToast]);
}

function mergeTweetsWithClientState(incomingTweets, existingTweets = []) {
  const clientMap = new Map(existingTweets.map((tweet) => [tweet.id, tweet]));

  return incomingTweets.map((tweet) => {
    const current = clientMap.get(tweet.id);
    if (!current) {
      return tweet;
    }

    return {
      ...tweet,
      client_simulated: current.client_simulated,
      client_created_at: current.client_created_at,
    };
  });
}

function appendTweetsWithClientState(currentTweets, incomingTweets) {
  const existingIds = new Set(currentTweets.map((tweet) => tweet.id));
  const incomingWithClientState = mergeTweetsWithClientState(incomingTweets, currentTweets);
  return [...currentTweets, ...incomingWithClientState.filter((tweet) => !existingIds.has(tweet.id))];
}

function buildHighlights(tweets) {
  if (!tweets.length) {
    return DEFAULT_HIGHLIGHTS;
  }

  return tweets.slice(0, 3).map((tweet, index) => ({
    title: tweet.caption || tweet.transcription_text?.split("\n")[0] || `${tweet.user.username} опубликовал запись`,
    meta: index === 0 ? "Сейчас в ленте" : "Недавняя запись",
    count: new Date(tweet.created_at).toLocaleDateString("ru-RU", { month: "short", day: "numeric" }),
  }));
}

function buildTweetsFeedPath(search, scope = "all", cursor = null) {
  const params = new URLSearchParams({ limit: "25" });
  if (search.trim()) {
    params.set("q", search.trim());
  }
  if (scope === "following") {
    params.set("scope", "following");
  }
  if (cursor?.created_at && cursor?.id) {
    params.set("cursor_created_at", cursor.created_at);
    params.set("cursor_id", String(cursor.id));
  }
  return `/tweets/feed?${params.toString()}`;
}

function buildProfilePath(search) {
  const params = new URLSearchParams();
  if (search.trim()) {
    params.set("q", search.trim());
  }
  const queryString = params.toString();
  return queryString ? `/profile?${queryString}` : "/profile";
}

function parseLiveEvent(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

function LoadingPosts() {
  return (
    <div className="post-list">
      {[0, 1, 2].map((item) => (
        <div className="m3-card" key={item} style={{ padding: 18 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div className="m3-skeleton" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div className="m3-skeleton" style={{ height: 12, width: 128 }} />
                <div className="m3-skeleton" style={{ height: 12, width: 62 }} />
              </div>
              <div className="m3-skeleton" style={{ height: 12, width: "88%" }} />
              <div className="m3-skeleton" style={{ height: 78, borderRadius: 12 }} />
              <div className="m3-skeleton" style={{ height: 96, borderRadius: 12 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedTabs({ activeTab, onChange }) {
  return (
    <div className="feed-switch-shell">
      <div className="feed-switch">
        {FEED_TABS.map((tab) => (
          <button
            className={["feed-switch__button", activeTab === tab.key ? "is-active" : ""].join(" ")}
            key={tab.key}
            onClick={() => onChange(tab.key)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyFeed({ actions = null, description, title }) {
  return (
    <div className="m3-card m3-empty empty-state-card">
      <p className="m3-section-label">Пусто</p>
      <h2 className="m3-title-medium empty-state-card__title" style={{ marginTop: 8, fontSize: 22 }}>
        {title}
      </h2>
      <p className="m3-body-small empty-state-card__description" style={{ marginTop: 8, maxWidth: 420 }}>
        {description}
      </p>
      {actions ? <div className="empty-state-card__actions">{actions}</div> : null}
    </div>
  );
}

function GuestPrompt() {
  return (
    <section className="m3-panel" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <BrandMark size={58} />
        <div>
          <p className="m3-section-label">Flutter</p>
          <h2 className="m3-title-medium" style={{ marginTop: 6, fontSize: 22 }}>
            Присоединяйтесь к аудиоленте
          </h2>
          <p className="m3-body-small" style={{ marginTop: 8, maxWidth: 440 }}>
            Записывайте голосовые посты, подписывайтесь на авторов и слушайте обсуждения с аккуратной транскрипцией.
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="m3-button m3-button-filled m3-fab m3-interactive" to="/register">
          Создать аккаунт
        </Link>
        <Link className="m3-button m3-button-outlined m3-interactive" to="/login">
          Войти
        </Link>
      </div>
    </section>
  );
}

function MobileNav({ composeActive = false, notificationsActive = false, onCompose, onOpenNotifications, onOpenSearch, searchActive = false, unreadCount = 0, user }) {
  const location = useLocation();

  const items = [
    { key: "home", label: "Главная", icon: Home, active: location.pathname === "/", to: "/" },
    { key: "search", label: "Поиск", icon: Search, active: searchActive, onClick: onOpenSearch },
    { key: "compose", label: "Запись", icon: Mic, active: composeActive, onClick: onCompose },
    { key: "alerts", label: "Уведомления", icon: Bell, active: notificationsActive, onClick: onOpenNotifications, hasBadge: unreadCount > 0 },
    { key: "profile", label: "Профиль", icon: User, active: location.pathname.startsWith("/profile"), to: user ? "/profile" : "/login" },
  ];

  return (
    <nav aria-label="Основная навигация" className="app-mobile-nav mobile-nav-safe">
      <div className="app-mobile-nav__inner">
        {items.map((item) => {
          const Icon = item.icon;
          const content = (
            <span
              className={["m3-nav-item", "m3-interactive", item.active ? "is-active" : ""].join(" ")}
              style={{ minHeight: 48, minWidth: 48, padding: 0, justifyContent: "center" }}
            >
              <span style={{ position: "relative", display: "inline-flex", width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
                <Icon size={20} strokeWidth={item.active ? 2.2 : 1.8} />
                {item.hasBadge ? <span className="m3-nav-item__badge" /> : null}
              </span>
            </span>
          );

          if (item.to) {
            return (
              <Link aria-label={item.label} key={item.key} to={item.to}>
                {content}
              </Link>
            );
          }

          return (
            <button aria-label={item.label} key={item.key} onClick={item.onClick} style={{ background: "none", border: 0, padding: 0 }} type="button">
              {content}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function AppShell({ children, onLiveEvent, renderComposer, rightRailItems, search, setSearch }) {
  const { logout, user } = useAuth();
  const showToast = useToast();
  const isPageVisible = usePageVisibility();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [notificationsRefreshToken, setNotificationsRefreshToken] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const mainColumnRef = useRef(null);
  const mainColumnScrollTopRef = useRef(0);
  const pendingScrollRestoreRef = useRef(null);
  const previousLocationRef = useRef(location);
  const scrollStorageKey = buildScrollStorageKey(location);

  const refreshNotificationsMeta = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    try {
      const data = await apiFetch("/notifications?limit=1");
      setUnreadCount(data.unread_count || 0);
    } catch {
      // Ignore notification refresh failures here.
    }
  }, [user]);

  useEffect(() => {
    void refreshNotificationsMeta();
  }, [refreshNotificationsMeta]);

  useLayoutEffect(() => {
    const mainColumn = mainColumnRef.current;
    if (!mainColumn) {
      return;
    }

    const previousLocation = previousLocationRef.current;
    const previousScrollKey = buildScrollStorageKey(previousLocation);
    const shouldRestoreHistoryScroll = navigationType === "POP" || lastBrowserNavigationWasPop;
    let nextScrollTop = 0;

    if (shouldRestoreHistoryScroll) {
      nextScrollTop = readMainColumnScrollPosition(scrollStorageKey) ?? 0;
    } else if (previousLocation.pathname === location.pathname) {
      nextScrollTop = readMainColumnScrollPosition(previousScrollKey) ?? mainColumn.scrollTop;
    }

    lastBrowserNavigationWasPop = false;

    if (nextScrollTop > 0) {
      pendingScrollRestoreRef.current = { key: scrollStorageKey, top: nextScrollTop };
      writePendingMainColumnScrollKey(scrollStorageKey);
    } else {
      pendingScrollRestoreRef.current = null;
      clearPendingMainColumnScrollKey(scrollStorageKey);
    }

    const restoreScroll = () => {
      mainColumn.scrollTo({ top: nextScrollTop, behavior: "auto" });
    };

    if (nextScrollTop <= 0) {
      restoreScroll();
      previousLocationRef.current = location;
      return undefined;
    }

    let resizeObserver;
    if (nextScrollTop > 0 && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(restoreScroll);
      resizeObserver.observe(mainColumn);
      if (mainColumn.firstElementChild) {
        resizeObserver.observe(mainColumn.firstElementChild);
      }
    }

    restoreScroll();
    const frameId = window.requestAnimationFrame(restoreScroll);
    const shortDelayId = window.setTimeout(restoreScroll, 120);
    const mediumDelayId = window.setTimeout(restoreScroll, 650);
    const longDelayId = window.setTimeout(() => {
      restoreScroll();
      pendingScrollRestoreRef.current = null;
      resizeObserver?.disconnect();
      clearPendingMainColumnScrollKey(scrollStorageKey);
    }, 1800);
    previousLocationRef.current = location;

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(shortDelayId);
      window.clearTimeout(mediumDelayId);
      window.clearTimeout(longDelayId);
      resizeObserver?.disconnect();
    };
  }, [location, navigationType, scrollStorageKey]);

  useEffect(() => {
    const mainColumn = mainColumnRef.current;
    if (!mainColumn) {
      return undefined;
    }

    const persistScrollPosition = (scrollTop) => {
      const normalizedScrollTop = Math.max(0, Math.round(scrollTop));
      mainColumnScrollTopRef.current = normalizedScrollTop;
      const pendingRestore = pendingScrollRestoreRef.current;
      if (
        pendingRestore?.key === scrollStorageKey &&
        pendingRestore.top > normalizedScrollTop
      ) {
        writeMainColumnScrollPosition(scrollStorageKey, pendingRestore.top);
        return;
      }
      writeMainColumnScrollPosition(scrollStorageKey, normalizedScrollTop);
    };

    const storeCurrentScrollPosition = () => {
      persistScrollPosition(mainColumn.scrollTop);
    };

    storeCurrentScrollPosition();
    mainColumn.addEventListener("scroll", storeCurrentScrollPosition, { passive: true });

    return () => {
      persistScrollPosition(mainColumnScrollTopRef.current);
      mainColumn.removeEventListener("scroll", storeCurrentScrollPosition);
    };
  }, [scrollStorageKey]);

  useEffect(() => {
    if (!isPageVisible) {
      return undefined;
    }

    const eventSource = createEventSource("/events/stream");
    const eventTypes = [...LIVE_REFRESH_EVENTS, "notification.created"];

    const handleEvent = (event) => {
      const payload = parseLiveEvent(event);
      if (!payload) {
        return;
      }

      onLiveEvent?.(payload);

      if (payload.type === "notification.created") {
        void refreshNotificationsMeta();
        setNotificationsRefreshToken((current) => current + 1);
        showToast(
          payload.notification_type === "transcription_ready" ? "Транскрипция записи готова." : "Получено новое уведомление.",
          payload.notification_type === "transcription_ready" ? "success" : "info",
        );
      }
    };

    eventTypes.forEach((eventType) => eventSource.addEventListener(eventType, handleEvent));

    return () => {
      eventTypes.forEach((eventType) => eventSource.removeEventListener(eventType, handleEvent));
      eventSource.close();
    };
  }, [isPageVisible, onLiveEvent, refreshNotificationsMeta, showToast]);

  const handleSearch = () => {
    const railSearchInput = document.querySelector('[data-global-search-input="rail"]');
    const isRailVisible = railSearchInput && railSearchInput.getClientRects().length > 0;

    if (isRailVisible) {
      railSearchInput.focus();
      return;
    }

    setIsSearchOpen(true);
  };

  const handleCompose = () => {
    if (!user) {
      navigate("/login", { state: { from: location.pathname } });
      return;
    }

    setIsComposerOpen(true);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const handleNotifications = () => {
    if (!user) {
      navigate("/login", { state: { from: location.pathname } });
      return;
    }

    setIsNotificationsOpen(true);
  };

  const closeSearch = useCallback(
    ({ clear = false } = {}) => {
      if (clear) {
        setSearch("");
      }
      setIsSearchOpen(false);
      setIsSearchFocused(false);
    },
    [setSearch],
  );

  const isSearchActive = isSearchOpen || isSearchFocused || Boolean(search.trim());

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (isComposerOpen) {
        return;
      }

      if (isSearchOpen) {
        closeSearch({ clear: true });
        return;
      }

      if (isNotificationsOpen) {
        setIsNotificationsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSearch, isComposerOpen, isNotificationsOpen, isSearchOpen]);

  return (
    <div className="app-shell">
      <div className="app-grid">
        <div className="app-nav-column">
          <div className="app-nav-sticky">
            <Sidebar
              isComposerActive={isComposerOpen}
              isNotificationsActive={isNotificationsOpen}
              isSearchActive={isSearchActive}
              onCompose={handleCompose}
              onLogout={() => void handleLogout()}
              onOpenNotifications={handleNotifications}
              onOpenSearch={handleSearch}
              unreadCount={unreadCount}
              user={user}
            />
          </div>
        </div>

        <main className="app-main-column" ref={mainColumnRef}>
          {typeof children === "function"
            ? children({
                openComposer: handleCompose,
                openNotifications: handleNotifications,
                openSearch: handleSearch,
                unreadCount,
              })
            : children}
        </main>

        <div className="app-side-column">
          <div className="app-side-sticky">
            <SearchPanel highlights={rightRailItems} onInputFocusChange={setIsSearchFocused} search={search} setSearch={setSearch} />
          </div>
        </div>
      </div>

      <MobileNav
        composeActive={isComposerOpen}
        notificationsActive={isNotificationsOpen}
        onCompose={handleCompose}
        onOpenNotifications={handleNotifications}
        onOpenSearch={handleSearch}
        searchActive={isSearchActive}
        unreadCount={unreadCount}
        user={user}
      />

      <NotificationSheet
        onClose={() => setIsNotificationsOpen(false)}
        onUnreadCountChange={setUnreadCount}
        open={isNotificationsOpen}
        refreshToken={notificationsRefreshToken}
      />

      <AnimatePresence>
        {isSearchOpen ? (
          <motion.div animate={{ opacity: 1 }} className="m3-overlay" exit={{ opacity: 0 }} initial={{ opacity: 0 }} onClick={() => closeSearch({ clear: true })}>
            <motion.div animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} initial={{ opacity: 0, y: 16 }} onClick={(event) => event.stopPropagation()}>
              <div className="m3-sheet" style={{ padding: 20 }}>
                <SearchPanel highlights={rightRailItems} mode="sheet" onClose={closeSearch} search={search} setSearch={setSearch} />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isComposerOpen && renderComposer ? (
          <motion.div animate={{ opacity: 1 }} className="m3-overlay m3-overlay--composer" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="voice-recorder-shell"
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              onClick={(event) => event.stopPropagation()}
            >
              {renderComposer({ close: () => setIsComposerOpen(false), user })}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function HomePage({
  activeTab,
  error,
  feed,
  hasMore = false,
  loading,
  loadingMore = false,
  onCreated,
  onLoadMore,
  onOpenComposer,
  onOpenNotifications,
  onOpenSearch,
  onRefreshRequested,
  search,
  setActiveTab,
  user,
}) {
  const location = useLocation();
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const headerHiddenRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    const scrollContainer = document.querySelector(".app-main-column");
    if (!scrollContainer) {
      return undefined;
    }

    lastScrollTopRef.current = scrollContainer.scrollTop;
    let frameId = 0;

    const updateHeaderVisibility = (nextHidden) => {
      if (headerHiddenRef.current === nextHidden) {
        return;
      }
      headerHiddenRef.current = nextHidden;
      setIsHeaderHidden(nextHidden);
    };

    const handleScroll = () => {
      if (frameId) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        const currentScrollTop = scrollContainer.scrollTop;
        const delta = currentScrollTop - lastScrollTopRef.current;

        if (currentScrollTop <= 48) {
          updateHeaderVisibility(false);
        } else if (delta > 18 && currentScrollTop > 96) {
          updateHeaderVisibility(true);
        } else if (delta < -18) {
          updateHeaderVisibility(false);
        }

        lastScrollTopRef.current = currentScrollTop;
        frameId = 0;
      });
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (loading) {
      return undefined;
    }

    const scrollContainer = document.querySelector(".app-main-column");
    const scrollKey = buildScrollStorageKey(location);
    const pendingScrollKey = readPendingMainColumnScrollKey();
    const storedScrollTop = readMainColumnScrollPosition(scrollKey) ?? 0;

    if (!scrollContainer || pendingScrollKey !== scrollKey || storedScrollTop <= 0) {
      return undefined;
    }

    const restoreScroll = () => {
      scrollContainer.scrollTo({ top: storedScrollTop, behavior: "auto" });
      if (Math.abs(scrollContainer.scrollTop - storedScrollTop) <= 2) {
        clearPendingMainColumnScrollKey(scrollKey);
      }
    };

    const retryDeadline = Date.now() + 1400;
    let retryTimeoutId = 0;
    const keepRestoring = () => {
      restoreScroll();
      if (Math.abs(scrollContainer.scrollTop - storedScrollTop) <= 2) {
        return;
      }
      if (Date.now() < retryDeadline) {
        retryTimeoutId = window.setTimeout(keepRestoring, 100);
      }
    };

    restoreScroll();
    const frameId = window.requestAnimationFrame(keepRestoring);
    const timeoutId = window.setTimeout(keepRestoring, 120);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      window.clearTimeout(retryTimeoutId);
    };
  }, [feed.length, loading, location]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const scrollContainer = document.querySelector(".app-main-column");
    if (!sentinel || !scrollContainer || !hasMore || loading || loadingMore) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore?.();
        }
      },
      { root: scrollContainer, rootMargin: "520px 0px 520px 0px", threshold: 0.01 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, onLoadMore]);

  return (
    <section>
      <header className={["top-app-bar", "top-app-bar--feed", isHeaderHidden ? "is-hidden" : ""].join(" ")}>
        <div className="top-app-bar__frame">
          <div className="top-app-bar__inner">
            <div className="top-app-bar__heading-group">
              <p className="m3-section-label top-app-bar__eyebrow">Слушать</p>
              <h1 className="top-app-bar__title">Лента</h1>
            </div>

            <div className="top-app-bar__actions top-app-bar__actions--compact">
              <button aria-label="Поиск" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={onOpenSearch} type="button">
                <Search size={18} />
              </button>
              <button aria-label="Уведомления" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={onOpenNotifications} type="button">
                <Bell size={18} />
              </button>
            </div>
          </div>
          <FeedTabs activeTab={activeTab} onChange={setActiveTab} />
        </div>
      </header>

      <div className="main-page-stack">
        {!user ? <GuestPrompt /> : null}
        {error ? <p className="m3-error">{error}</p> : null}

        {loading ? (
          <LoadingPosts />
        ) : activeTab === "following" && !user ? (
          <EmptyFeed description="Войдите и подпишитесь на авторов, чтобы собрать персональную ленту." title="Подписки доступны после входа" />
        ) : feed.length ? (
          <div className="post-list">
            {feed.map((tweet) => (
              <PostCard
                currentUser={user}
                key={tweet.id}
                onDeleted={(tweetId) => onCreated({ deletedId: tweetId })}
                onRefreshRequested={onRefreshRequested}
                tweet={tweet}
              />
            ))}
            <div aria-hidden="true" className="feed-load-more-sentinel" ref={loadMoreRef} />
            {hasMore ? (
              <button className="m3-button m3-button-outlined m3-interactive feed-load-more" disabled={loadingMore} onClick={onLoadMore} type="button">
                {loadingMore ? "Загрузка…" : "Показать ещё"}
              </button>
            ) : null}
          </div>
        ) : (
          <EmptyFeed
            description={
              search
                ? "Попробуйте другой запрос или переключите вкладку ленты."
                : activeTab === "following"
                  ? "Подпишитесь на нескольких авторов, и их новые записи появятся здесь."
                  : "Запишите первый голосовой пост или загляните немного позже."
            }
            title="Пока здесь пусто"
          />
        )}
      </div>
    </section>
  );
}

function HomeRoute({ search, setSearch }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const deferredSearch = useDeferredValue(search);
  const [error, setError] = useState("");
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);

  const activeTab = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("feed") === "following" ? "following" : "for-you";
  }, [location.search]);

  const setActiveTab = useCallback(
    (nextTab) => {
      const nextParams = new URLSearchParams(location.search);
      if (nextTab === "following") {
        nextParams.set("feed", "following");
      } else {
        nextParams.delete("feed");
      }

      navigate(
        {
          pathname: location.pathname,
          search: nextParams.toString() ? `?${nextParams.toString()}` : "",
        },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  const loadFeed = useCallback(
    async ({ append = false, cursor = null, silent = false } = {}) => {
      try {
        if (append) {
          setLoadingMore(true);
        } else if (!silent) {
          setLoading(true);
        }
        const data = await apiFetch(buildTweetsFeedPath(deferredSearch, activeTab === "following" ? "following" : "all", cursor));
        setFeed((current) =>
          append
            ? appendTweetsWithClientState(current, data.items || [])
            : mergeTweetsWithClientState(data.items || [], current),
        );
        setNextCursor(data.next_cursor || null);
        setError("");
      } catch (caughtError) {
        setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось загрузить ленту.");
      } finally {
        if (append) {
          setLoadingMore(false);
        } else if (!silent) {
          setLoading(false);
        }
      }
    },
    [activeTab, deferredSearch],
  );

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const handleLiveEvent = useCallback(
    (payload) => {
      if (LIVE_REFRESH_EVENTS.has(payload.type)) {
        void loadFeed({ silent: true });
      }
    },
    [loadFeed],
  );

  const highlights = useMemo(() => buildHighlights(feed), [feed]);

  const handleCreated = useCallback((tweet) => {
    if (tweet?.deletedId) {
      setFeed((current) => current.filter((item) => item.id !== tweet.deletedId));
      return;
    }

    setFeed((current) => [tweet, ...current.filter((item) => item.id !== tweet.id)]);
  }, []);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading || loadingMore) {
      return;
    }

    void loadFeed({ append: true, cursor: nextCursor, silent: true });
  }, [loadFeed, loading, loadingMore, nextCursor]);

  return (
    <AppShell
      onLiveEvent={handleLiveEvent}
      renderComposer={({ close }) => <PostComposer onClose={close} onCreated={handleCreated} user={user} variant="modal" />}
      rightRailItems={highlights}
      search={search}
      setSearch={setSearch}
    >
      {({ openComposer, openNotifications, openSearch }) => (
        <HomePage
          activeTab={activeTab}
          error={error}
          feed={feed}
          hasMore={Boolean(nextCursor)}
          loading={loading}
          loadingMore={loadingMore}
          onCreated={handleCreated}
          onLoadMore={loadMore}
          onOpenComposer={openComposer}
          onOpenNotifications={openNotifications}
          onOpenSearch={openSearch}
          onRefreshRequested={() => void loadFeed({ silent: true })}
          search={search}
          setActiveTab={setActiveTab}
          user={user}
        />
      )}
    </AppShell>
  );
}

function ProfileRoute({ search, setSearch }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const deferredSearch = useDeferredValue(search);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  const loadProfile = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (!silent) {
          setLoading(true);
        }
        const data = await apiFetch(buildProfilePath(deferredSearch));
        setProfile((current) =>
          current
            ? {
                ...data,
                tweets: mergeTweetsWithClientState(data.tweets || [], current.tweets || []),
              }
            : data,
        );
        setError("");
      } catch (caughtError) {
        setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось загрузить профиль.");
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [deferredSearch],
  );

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const highlights = useMemo(() => buildHighlights(profile?.tweets || []), [profile?.tweets]);
  const profileAvatarUrl = profile?.user?.avatar_url ? getMediaUrl(profile.user.avatar_url) : "";

  const handleLiveEvent = useCallback(
    (payload) => {
      if (payload.type === "tweet.created" && payload.user_id !== user?.id) {
        return;
      }
      if (LIVE_REFRESH_EVENTS.has(payload.type)) {
        void loadProfile({ silent: true });
      }
    },
    [loadProfile, user?.id],
  );

  const handleCreated = useCallback((tweet) => {
    if (tweet?.deletedId) {
      setProfile((current) =>
        current
          ? {
              ...current,
              tweets: current.tweets.filter((item) => item.id !== tweet.deletedId),
            }
          : current,
      );
      return;
    }

    setProfile((current) =>
      current
        ? {
            ...current,
            tweets: [tweet, ...current.tweets.filter((item) => item.id !== tweet.id)],
          }
        : current,
    );
  }, []);

  return (
    <AppShell
      onLiveEvent={handleLiveEvent}
      renderComposer={({ close }) => <PostComposer onClose={close} onCreated={handleCreated} user={user} variant="modal" />}
      rightRailItems={highlights}
      search={search}
      setSearch={setSearch}
    >
      {({ openComposer }) => (
        <section>
          <header className="top-app-bar">
            <div className="top-app-bar__inner page-header-bar">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button aria-label="Назад" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={() => navigate("/")} type="button">
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <p className="m3-section-label">Ваше пространство</p>
                  <h1 className="top-app-bar__title m3-break-anywhere" style={{ fontSize: 22 }}>
                    {profile?.user?.username || user?.username}
                  </h1>
                </div>
              </div>
              <p className="m3-body-small page-header-bar__meta">{profile?.tweets?.length || 0} записей</p>
            </div>
          </header>

          <div className="main-page-stack">
            <section className="m3-panel profile-hero">
              <div className="profile-hero__main">
                <div className="profile-hero__summary">
                  {profileAvatarUrl ? (
                    <img alt={profile?.user?.username || user?.username || "Avatar"} src={profileAvatarUrl} style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--md-sys-color-outline)" }} />
                  ) : (
                    <div className="m3-avatar" style={{ width: 80, height: 80, fontSize: 26 }}>
                      {(profile?.user?.username || user?.username || "?").slice(0, 2).toUpperCase()}
                    </div>
                  )}

                  <div className="profile-hero__identity">
                    <div className="profile-hero__headline">
                      <p className="m3-title-medium profile-hero__name">
                        {profile?.user?.username || user?.username}
                      </p>
                      {String(profile?.user?.role || user?.role || "").toLowerCase() === "admin" ? <Shield size={16} style={{ color: "var(--md-sys-color-primary)" }} /> : null}
                    </div>
                    <p className="m3-body-small profile-hero__handle">
                      @{(profile?.user?.username || user?.username || "").toLowerCase()}
                    </p>
                    <p className="profile-hero__bio">
                      {profile?.user?.bio || "Добавьте описание в настройках, чтобы слушатели понимали, что вы публикуете."}
                    </p>
                  </div>
                </div>

                <div className="profile-hero__actions">
                  <Link className="m3-button m3-button-outlined m3-interactive" to="/settings">
                    Настройки
                  </Link>
                </div>
              </div>

              <hr className="m3-divider" style={{ margin: "18px 0" }} />

              <div className="profile-stats-grid">
                <span className="m3-body-small profile-stat-card">
                  <strong>{profile?.following_count || 0}</strong>
                  Подписки
                </span>
                <span className="m3-body-small profile-stat-card">
                  <strong>{profile?.follower_count || 0}</strong>
                  Подписчики
                </span>
                <span className="m3-body-small profile-stat-card">
                  <strong>С нами</strong>
                  {new Date(profile?.user?.created_at || user?.created_at || Date.now()).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
                </span>
              </div>
            </section>

            {error ? <p className="m3-error">{error}</p> : null}

            {loading && !profile ? (
              <LoadingPosts />
            ) : profile?.tweets?.length ? (
              <div className="post-list">
                {profile.tweets.map((tweet) => (
                  <PostCard
                    currentUser={user}
                    key={tweet.id}
                    onDeleted={(tweetId) => handleCreated({ deletedId: tweetId })}
                    onRefreshRequested={() => void loadProfile({ silent: true })}
                    tweet={tweet}
                  />
                ))}
              </div>
            ) : (
              <EmptyFeed
                actions={
                  <>
                    <button className="m3-button m3-button-filled m3-fab m3-interactive" onClick={openComposer} type="button">
                      Начать запись
                    </button>
                    <Link className="m3-button m3-button-outlined m3-interactive" to="/settings">
                      Редактировать профиль
                    </Link>
                  </>
                }
                description="Запишите первый клип и добавьте короткое описание, чтобы слушатели сразу поняли, что вы публикуете."
                title="Поделитесь первой голосовой записью"
              />
            )}
          </div>
        </section>
      )}
    </AppShell>
  );
}

function AdminRoute({ search, setSearch }) {
  const { user } = useAuth();

  return (
    <AppShell
      renderComposer={({ close }) => <PostComposer onClose={close} onCreated={() => undefined} user={user} variant="modal" />}
      rightRailItems={DEFAULT_HIGHLIGHTS}
      search={search}
      setSearch={setSearch}
    >
      <AdminDashboard />
    </AppShell>
  );
}

function ThreadRoute({ search, setSearch }) {
  const { user } = useAuth();

  return (
    <AppShell
      renderComposer={({ close }) => <PostComposer onClose={close} onCreated={() => undefined} user={user} variant="modal" />}
      rightRailItems={DEFAULT_HIGHLIGHTS}
      search={search}
      setSearch={setSearch}
    >
      <PostThreadPage />
    </AppShell>
  );
}

function PublicProfileRoute({ search, setSearch }) {
  const { user } = useAuth();

  return (
    <AppShell
      renderComposer={({ close }) => <PostComposer onClose={close} onCreated={() => undefined} user={user} variant="modal" />}
      rightRailItems={DEFAULT_HIGHLIGHTS}
      search={search}
      setSearch={setSearch}
    >
      <PublicProfilePage />
    </AppShell>
  );
}

function SettingsRoute({ search, setSearch }) {
  const { user } = useAuth();

  return (
    <AppShell
      renderComposer={({ close }) => <PostComposer onClose={close} onCreated={() => undefined} user={user} variant="modal" />}
      rightRailItems={DEFAULT_HIGHLIGHTS}
      search={search}
      setSearch={setSearch}
    >
      <SettingsPage />
    </AppShell>
  );
}

function SearchRoute({ search, setSearch }) {
  const { user } = useAuth();

  return (
    <AppShell
      renderComposer={({ close }) => <PostComposer onClose={close} onCreated={() => undefined} user={user} variant="modal" />}
      rightRailItems={DEFAULT_HIGHLIGHTS}
      search={search}
      setSearch={setSearch}
    >
      <section>
        <header className="top-app-bar">
          <div className="top-app-bar__inner page-header-bar">
            <div>
              <p className="m3-section-label">Поиск</p>
              <h1 className="top-app-bar__title" style={{ fontSize: 22 }}>
                Записи, люди и темы
              </h1>
            </div>
            <p className="m3-body-small page-header-bar__meta">Фильтруйте ленту без потери контекста</p>
          </div>
        </header>

        <div className="main-page-stack">
          <div className="search-page-panel">
            <SearchPanel mode="page" search={search} setSearch={setSearch} />
          </div>
        </div>
      </section>
    </AppShell>
  );
}

export function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const { login, register, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const redirectPath = resolvePostAuthPath(location.state?.from);

  if (user) {
    return <Navigate replace to={redirectPath} />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setBusy(true);
      setError("");

      if (isRegister) {
        await register(form);
      } else {
        await login({ email: form.email, password: form.password });
      }

      navigate(redirectPath, { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось выполнить вход.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-frame">
        <section className="auth-poster">
          <div className="auth-poster__content">
            <div className="auth-poster__brand">
              <BrandMark size={56} />
              <div>
                <p className="m3-section-label">Flutter</p>
                <p className="m3-title-medium" style={{ marginTop: 4 }}>
                  Аудио-социальная сеть
                </p>
              </div>
            </div>

            <div className="auth-poster__hero">
              <h1 className="auth-poster__headline">
                Ваш голос остаётся в центре ленты.
              </h1>

              <p className="auth-poster__description">
                Записывайте с микрофона или загружайте файл, обрезайте клип и получайте удобную транскрипцию.
              </p>
            </div>

            <div className="auth-waveform auth-poster__waveform">
              {AUTH_SOUND_BARS.map((height, index) => (
                <span key={`${index}-${height}`} style={{ height }} />
              ))}
            </div>

            <div className="auth-signal-grid">
              {AUTH_SIGNAL_ITEMS.map((item) => (
                <div className="m3-card auth-signal-card" key={item.title}>
                  <p className="m3-title-medium">{item.title}</p>
                  <p className="m3-body-small" style={{ marginTop: 6 }}>
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="auth-panel">
          <p className="m3-section-label">{isRegister ? "Присоединяйтесь" : "С возвращением"}</p>
          <h2 className="m3-title-medium" style={{ marginTop: 8, fontSize: 28 }}>
            {isRegister ? "Создать аккаунт" : "Войти"}
          </h2>
          <p className="m3-body-small" style={{ marginTop: 8 }}>
            {isRegister ? "Начните публиковать и слушать уже через пару секунд." : "Продолжайте там, где остановились."}
          </p>

          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16, marginTop: 28 }}>
            {isRegister ? (
              <label style={{ display: "grid", gap: 8 }}>
                <span className="m3-title-medium" style={{ fontSize: 14 }}>
                  Имя пользователя
                </span>
                <input
                  autoComplete="username"
                  className="m3-input"
                  name="username"
                  onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                  placeholder="vashe_imya"
                  required
                  spellCheck={false}
                  type="text"
                  value={form.username}
                />
              </label>
            ) : null}

            <label style={{ display: "grid", gap: 8 }}>
              <span className="m3-title-medium" style={{ fontSize: 14 }}>
                Email
              </span>
              <input
                autoComplete="email"
                className="m3-input"
                name="email"
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="hello@example.com"
                required
                spellCheck={false}
                type="email"
                value={form.email}
              />
            </label>

            <label style={{ display: "grid", gap: 8 }}>
              <span className="m3-title-medium" style={{ fontSize: 14 }}>
                Пароль
              </span>
              <div className="password-field">
                <input
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  className="m3-input password-field__input"
                  name="password"
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder="Минимум 8 символов"
                  required
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                />
                <button
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  aria-pressed={showPassword}
                  className="password-field__toggle m3-interactive m3-state-neutral"
                  onClick={() => setShowPassword((current) => !current)}
                  type="button"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {error ? <p className="m3-error">{error}</p> : null}

            <button className="m3-button m3-button-filled m3-fab m3-interactive" disabled={busy} style={{ width: "100%", justifyContent: "center" }} type="submit">
              {busy ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> : null}
              {busy ? "Подождите…" : isRegister ? "Создать аккаунт" : "Войти"}
            </button>
          </form>

          <p className="m3-body-small" style={{ marginTop: 22 }}>
            {isRegister ? "Уже есть аккаунт? " : "Нет аккаунта? "}
            <Link className="m3-link" to={isRegister ? "/login" : "/register"}>
              {isRegister ? "Войти" : "Создать"}
            </Link>
          </p>
        </section>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Routed(element) {
  return <RouteErrorBoundary>{element}</RouteErrorBoundary>;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearchState] = useState(() => new URLSearchParams(location.search).get("q") ?? "");

  useEffect(() => {
    setSearchState(new URLSearchParams(location.search).get("q") ?? "");
  }, [location.search]);

  const setSearch = useCallback(
    (nextSearch) => {
      const params = new URLSearchParams(location.search);
      if (nextSearch.length) {
        params.set("q", nextSearch);
      } else {
        params.delete("q");
      }

      startTransition(() => {
        setSearchState(nextSearch);
        navigate(
          {
            pathname: location.pathname,
            search: params.toString() ? `?${params.toString()}` : "",
          },
          { replace: true },
        );
      });
    },
    [location.pathname, location.search, navigate],
  );

  useNetworkToasts();

  return (
    <Routes>
      <Route element={Routed(<AuthPage mode="login" />)} path="/login" />
      <Route element={Routed(<AuthPage mode="register" />)} path="/register" />
      <Route element={Routed(<HomeRoute search={search} setSearch={setSearch} />)} path="/" />
      <Route element={Routed(<SearchRoute search={search} setSearch={setSearch} />)} path="/search" />
      <Route element={Routed(<ThreadRoute search={search} setSearch={setSearch} />)} path="/post/:postId" />
      <Route
        element={Routed(
          <ProtectedRoute roles={["user", "admin"]}>
            <ProfileRoute search={search} setSearch={setSearch} />
          </ProtectedRoute>,
        )}
        path="/profile"
      />
      <Route element={Routed(<PublicProfileRoute search={search} setSearch={setSearch} />)} path="/profile/:profileId" />
      <Route
        element={Routed(
          <ProtectedRoute roles={["user", "admin"]}>
            <SettingsRoute search={search} setSearch={setSearch} />
          </ProtectedRoute>,
        )}
        path="/settings"
      />
      <Route
        element={Routed(
          <ProtectedRoute roles={["admin"]}>
            <AdminRoute search={search} setSearch={setSearch} />
          </ProtectedRoute>,
        )}
        path="/admin"
      />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}
