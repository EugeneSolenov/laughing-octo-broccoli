import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Bell, Feather, Home, LoaderCircle, Search, Shield, User } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { ApiError, apiFetch, createEventSource, getMediaUrl } from "./api/client";
import AdminDashboard from "./components/AdminDashboard.jsx";
import EditProfileDialog from "./components/EditProfileDialog.jsx";
import NotificationSheet from "./components/NotificationSheet.jsx";
import PostCard from "./components/PostCard.jsx";
import PostComposer from "./components/PostComposer.jsx";
import PostThreadPage from "./components/PostThreadPage.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import PublicProfilePage from "./components/PublicProfilePage.jsx";
import RouteErrorBoundary from "./components/RouteErrorBoundary.jsx";
import SearchPanel from "./components/SearchPanel.jsx";
import Sidebar from "./components/Sidebar.jsx";
import SettingsPage from "./components/SettingsPage.jsx";
import OnboardingChecklist from "./components/OnboardingChecklist.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { useToast } from "./context/ToastContext.jsx";

const FEED_TABS = [
  { key: "for-you", label: "For you" },
  { key: "following", label: "Following" },
];

const DEFAULT_HIGHLIGHTS = [
  { title: "Voice AI", meta: "Technology - Trending", count: "42.5K posts" },
  { title: "Creator updates", meta: "Social media - Live", count: "18.4K posts" },
  { title: "Audio-first communities", meta: "Design - New", count: "7,482 posts" },
];

const LIVE_REFRESH_EVENTS = new Set([
  "tweet.created",
  "tweet.deleted",
  "tweet.engagement_updated",
  "tweet.transcription_updated",
]);

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
    const handleOnline = () => showToast("Back online.", "success");
    const handleOffline = () => showToast("You're offline. Some actions may fail.", "info");

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

function buildHighlights(tweets) {
  if (!tweets.length) {
    return DEFAULT_HIGHLIGHTS;
  }

  const recent = tweets.slice(0, 3);

  return recent.map((tweet, index) => ({
    title: `${tweet.user.username} posted audio`,
    meta: index === 0 ? "Live in the feed" : "Fresh voice post",
    count: `${new Date(tweet.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
  }));
}

function buildTweetsFeedPath(search, scope = "all") {
  const params = new URLSearchParams({ limit: "25" });
  if (search.trim()) {
    params.set("q", search.trim());
  }
  if (scope === "following") {
    params.set("scope", "following");
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
    <div>
      {[0, 1, 2].map((item) => (
        <div className="border-b border-x-border px-4 py-5 phone:px-5" key={item}>
          <div className="flex gap-3">
            <div className="h-10 w-10 rounded-full bg-[#1d1f23]" />
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <div className="skeleton-bar h-4 w-28 rounded-full animate-shimmer" />
                <div className="skeleton-bar h-3 w-16 rounded-full animate-shimmer" />
              </div>
              <div className="rounded-[20px] border border-x-border bg-[#111214] p-4">
                <div className="skeleton-bar h-3 rounded-full animate-shimmer" />
                <div className="mt-2 skeleton-bar h-3 w-10/12 rounded-full animate-shimmer" />
                <div className="mt-4 skeleton-bar h-14 rounded-[16px] animate-shimmer" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedTabs({ activeTab, onChange }) {
  return (
    <div className="grid grid-cols-2">
      {FEED_TABS.map((tab) => {
        const active = activeTab === tab.key;

        return (
          <button
            className="relative flex items-center justify-center px-4 py-4 text-[15px] font-bold text-x-primary transition hover:bg-white/[0.03]"
            key={tab.key}
            onClick={() => onChange(tab.key)}
            type="button"
          >
            <span className={active ? "text-x-primary" : "text-x-secondary"}>{tab.label}</span>
            {active ? <motion.span className="absolute bottom-0 h-1 w-14 rounded-full bg-x-blue" layoutId="feed-underline" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function EmptyFeed({ description, title }) {
  return (
    <div className="px-4 py-10 phone:px-5">
      <div className="rounded-[24px] border border-x-border bg-[#111214] p-6">
        <h2 className="text-[31px] font-extrabold leading-8 text-x-primary">{title}</h2>
        <p className="mt-3 max-w-md text-[15px] leading-6 text-x-secondary">{description}</p>
      </div>
    </div>
  );
}

function GuestPrompt() {
  return (
    <div className="border-b border-x-border px-4 py-6 phone:px-5">
      <div className="rounded-[24px] border border-x-border bg-[#111214] p-6">
        <p className="text-[31px] font-extrabold leading-8 text-x-primary">Join Voice Atlas today</p>
        <p className="mt-3 text-[15px] leading-6 text-x-secondary">
          Create an account to post voice notes, follow people you care about, and personalize your feed.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="rounded-full bg-white px-5 py-2.5 text-[15px] font-bold text-black transition hover:bg-white/90" to="/register">
            Create account
          </Link>
          <Link className="rounded-full border border-x-border px-5 py-2.5 text-[15px] font-bold text-x-primary transition hover:bg-x-hover" to="/login">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}

function MobileNav({ onCompose, onOpenNotifications, onOpenSearch, unreadCount = 0, user }) {
  const location = useLocation();
  const navigate = useNavigate();

  const items = [
    { key: "home", label: "Home", icon: Home, active: location.pathname === "/", onClick: () => navigate("/") },
    { key: "search", label: "Open search", icon: Search, active: false, onClick: onOpenSearch },
    { key: "compose", label: "Create post", icon: Feather, active: false, onClick: onCompose },
    { key: "alerts", label: "Open notifications", icon: Bell, active: false, onClick: onOpenNotifications },
    {
      key: "profile",
      label: "Open profile",
      icon: User,
      active: location.pathname.startsWith("/profile"),
      onClick: () => navigate(user ? "/profile" : "/login"),
    },
  ];

  return (
    <nav className="tablet:hidden fixed inset-x-0 bottom-0 z-30 border-t border-x-border bg-black/90 backdrop-blur-md mobile-nav-safe">
      <div className="mx-auto flex h-16 max-w-[600px] items-center justify-around">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              className={["relative inline-flex h-11 w-11 items-center justify-center rounded-full transition", item.active ? "bg-x-hover text-x-primary" : "text-x-secondary"].join(" ")}
              key={item.key}
              onClick={item.onClick}
              type="button"
            >
              <Icon className="h-[22px] w-[22px]" fill={item.active ? "currentColor" : "none"} />
              {item.key === "alerts" && unreadCount ? (
                <span className="absolute right-1 top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-x-blue px-1.5 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
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
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [notificationsRefreshToken, setNotificationsRefreshToken] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshNotificationsMeta = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    try {
      const data = await apiFetch("/notifications?limit=1");
      setUnreadCount(data.unread_count || 0);
    } catch {
      // Ignore notification refresh failures here. The panel itself surfaces actionable errors.
    }
  }, [user]);

  useEffect(() => {
    void refreshNotificationsMeta();
  }, [refreshNotificationsMeta]);

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
          payload.notification_type === "transcription_ready" ? "A voice post finished transcribing." : "New notification received.",
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
    if (typeof window !== "undefined" && window.innerWidth >= 1280) {
      document.getElementById("global-search-input")?.focus();
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

  return (
    <div className="min-h-screen bg-black text-x-primary">
      <div className="mx-auto flex max-w-[1275px] justify-center">
        <div className="hidden tablet:block tablet:w-[88px] desktop:w-[275px]">
          <div className="fixed top-0 h-screen w-[88px] desktop:w-[275px]">
            <Sidebar
              onCompose={handleCompose}
              onLogout={() => void handleLogout()}
              onOpenNotifications={handleNotifications}
              onOpenSearch={handleSearch}
              unreadCount={unreadCount}
              user={user}
            />
          </div>
        </div>

        <main className="min-h-screen w-full max-w-[600px] border-x border-x-border pb-20 tablet:pb-0">
          {typeof children === "function" ? children({ openComposer: handleCompose, openSearch: handleSearch }) : children}
        </main>

        <div className="hidden desktop:block desktop:w-[350px] desktop:pl-[30px]">
          <div className="sticky top-0 h-screen overflow-y-auto pb-10">
            <SearchPanel highlights={rightRailItems} search={search} setSearch={setSearch} />
          </div>
        </div>
      </div>

      <MobileNav
        onCompose={handleCompose}
        onOpenNotifications={handleNotifications}
        onOpenSearch={handleSearch}
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
          <motion.div
            animate={{ opacity: 1 }}
            className="desktop:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={() => setIsSearchOpen(false)}
          >
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto mt-0 max-w-[600px] px-4 py-4"
              exit={{ opacity: 0, y: 16 }}
              initial={{ opacity: 0, y: 16 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="rounded-[24px] border border-x-border bg-black p-4 shadow-lift">
                <SearchPanel highlights={rightRailItems} mode="sheet" onClose={() => setIsSearchOpen(false)} search={search} setSearch={setSearch} />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isComposerOpen && renderComposer ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-black/75 px-4 py-6 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={() => setIsComposerOpen(false)}
          >
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="mx-auto max-w-[680px]"
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

function HomePage({ activeTab, error, feed, loading, onCreated, onOpenComposer, onOpenSearch, onRefreshRequested, search, setActiveTab, user }) {
  return (
    <section>
      <header className="sticky top-0 z-20 border-b border-x-border bg-black/80 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-3 phone:px-5">
          <p className="text-[20px] font-extrabold text-x-primary">Home</p>
          <div className="flex items-center gap-2 tablet:hidden">
            <button aria-label="Open search" className="x-icon-button h-10 w-10" onClick={onOpenSearch} type="button">
              <Search className="h-5 w-5" />
            </button>
            <button aria-label="Create a voice post" className="x-icon-button h-10 w-10" onClick={onOpenComposer} type="button">
              <Feather className="h-5 w-5" />
            </button>
          </div>
        </div>
        <FeedTabs activeTab={activeTab} onChange={setActiveTab} />
      </header>

      {user ? (
        <>
          <OnboardingChecklist onOpenComposer={onOpenComposer} onOpenSearch={onOpenSearch} user={user} />
          <PostComposer onCreated={onCreated} user={user} />
        </>
      ) : (
        <GuestPrompt />
      )}

      {error ? <p className="mx-4 mt-4 rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100 phone:mx-5">{error}</p> : null}

      {loading ? (
        <LoadingPosts />
      ) : activeTab === "following" && !user ? (
        <EmptyFeed
          description="Sign in and follow people to build a real following feed."
          title="Your following feed starts after login"
        />
      ) : feed.length ? (
        feed.map((tweet) => (
          <PostCard
            currentUser={user}
            key={tweet.id}
            onDeleted={(tweetId) => onCreated({ deletedId: tweetId })}
            onRefreshRequested={onRefreshRequested}
            tweet={tweet}
          />
        ))
      ) : (
        <EmptyFeed
          description={
            search
              ? "Try another search or switch feed tabs to see a different set of voice posts."
              : activeTab === "following"
                ? "Follow a few creators and their voice posts will show up here."
                : "Record the first voice post or check back in a little later."
          }
          title="Nothing to hear right now"
        />
      )}
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
    async ({ silent = false } = {}) => {
      try {
        if (!silent) {
          setLoading(true);
        }
        const data = await apiFetch(buildTweetsFeedPath(deferredSearch, activeTab === "following" ? "following" : "all"));
        setFeed((current) => mergeTweetsWithClientState(data.items, current));
        setError("");
      } catch (caughtError) {
        setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load the feed.");
      } finally {
        if (!silent) {
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

  return (
    <AppShell
      onLiveEvent={handleLiveEvent}
      renderComposer={({ close }) => <PostComposer onClose={close} onCreated={handleCreated} user={user} variant="modal" />}
      rightRailItems={highlights}
      search={search}
      setSearch={setSearch}
    >
      {({ openComposer, openSearch }) => (
        <HomePage
          activeTab={activeTab}
          error={error}
          feed={feed}
          loading={loading}
          onCreated={handleCreated}
          onOpenComposer={openComposer}
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
  const [isEditingProfile, setIsEditingProfile] = useState(false);
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
        setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load your profile.");
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
      {({ openComposer, openSearch }) => (
        <section>
          <header className="sticky top-0 z-20 border-b border-x-border bg-black/80 backdrop-blur-md">
            <div className="flex items-center justify-between px-4 py-3 phone:px-5">
              <div className="flex items-center gap-4">
                <button aria-label="Go back home" className="x-icon-button h-9 w-9" onClick={() => navigate("/")} type="button">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div>
                  <p className="text-[20px] font-extrabold text-x-primary">{profile?.user?.username || user?.username}</p>
                  <p className="text-[13px] text-x-secondary">{profile?.tweets?.length || 0} posts</p>
                </div>
              </div>
              <div className="flex items-center gap-2 tablet:hidden">
                <button aria-label="Open search" className="x-icon-button h-10 w-10" onClick={openSearch} type="button">
                  <Search className="h-5 w-5" />
                </button>
                <button aria-label="Create a voice post" className="x-icon-button h-10 w-10" onClick={openComposer} type="button">
                  <Feather className="h-5 w-5" />
                </button>
              </div>
            </div>
          </header>

          <div className="h-40 border-b border-x-border bg-[radial-gradient(circle_at_top,_rgba(29,155,240,0.45),_transparent_58%),linear-gradient(180deg,_#1d1f23_0%,_#0b0c0d_100%)]" />

          <div className="border-b border-x-border px-4 pb-5 phone:px-5">
            <div className="flex items-end justify-between gap-4">
              {profileAvatarUrl ? (
                <img
                  alt={profile?.user?.username || user?.username || "Profile avatar"}
                  className="-mt-16 h-28 w-28 rounded-full border-4 border-black object-cover"
                  src={profileAvatarUrl}
                />
              ) : (
                <div className="-mt-16 flex h-28 w-28 items-center justify-center rounded-full border-4 border-black bg-[#1d9bf0]/15 text-[34px] font-extrabold text-x-blue">
                  {profile?.user?.username?.slice(0, 2).toUpperCase() || user?.username?.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                <button
                  className="rounded-full border border-x-border px-4 py-2 text-[15px] font-bold text-x-primary transition hover:bg-x-hover"
                  onClick={() => setIsEditingProfile(true)}
                  type="button"
                >
                  Edit profile
                </button>
                <button
                  className="rounded-full border border-x-border px-4 py-2 text-[15px] font-bold text-x-primary transition hover:bg-x-hover"
                  onClick={() => navigate("/settings")}
                  type="button"
                >
                  Settings
                </button>
                <button
                  className="rounded-full border border-x-border px-4 py-2 text-[15px] font-bold text-x-primary transition hover:bg-x-hover"
                  onClick={openComposer}
                  type="button"
                >
                  New voice post
                </button>
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center gap-2">
                <p className="text-[20px] font-extrabold text-x-primary">{profile?.user?.username || user?.username}</p>
                {String(profile?.user?.role || user?.role || "").toLowerCase() === "admin" ? <Shield className="h-[18px] w-[18px] text-x-blue" /> : null}
              </div>
              <p className="mt-1 text-[15px] text-x-secondary">@{(profile?.user?.username || user?.username || "").toLowerCase()}</p>
              <p className="mt-4 max-w-xl text-[15px] leading-6 text-x-primary">
                {profile?.user?.bio || "Share quick voice updates and keep your latest posts in one place."}
              </p>
              <p className="mt-3 text-[14px] text-x-secondary">
                Joined {new Date(profile?.user?.created_at || user?.created_at || Date.now()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </p>
              <div className="mt-4 flex flex-wrap gap-5 text-[15px]">
                <p>
                  <span className="font-bold text-x-primary">{profile?.following_count || 0}</span>{" "}
                  <span className="text-x-secondary">Following</span>
                </p>
                <p>
                  <span className="font-bold text-x-primary">{profile?.follower_count || 0}</span>{" "}
                  <span className="text-x-secondary">Followers</span>
                </p>
              </div>
            </div>
          </div>

          {error ? <p className="mx-4 mt-4 rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100 phone:mx-5">{error}</p> : null}

          {loading && !profile ? (
            <LoadingPosts />
          ) : profile?.tweets?.length ? (
            profile.tweets.map((tweet) => (
              <PostCard
                currentUser={user}
                key={tweet.id}
                onDeleted={(tweetId) => handleCreated({ deletedId: tweetId })}
                onRefreshRequested={() => void loadProfile({ silent: true })}
                tweet={tweet}
              />
            ))
          ) : (
            <EmptyFeed description="Your voice posts will appear here after upload and transcription." title="No profile posts yet" />
          )}

          <EditProfileDialog
            onClose={() => setIsEditingProfile(false)}
            onSaved={(updatedProfile) => setProfile(updatedProfile)}
            open={isEditingProfile}
            profile={profile}
          />
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
      {({ openComposer, openSearch }) => <PublicProfilePage onOpenComposer={openComposer} onOpenSearch={openSearch} />}
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

function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const { login, register, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ username: "", email: "", password: "" });

  if (user) {
    return <Navigate replace to="/" />;
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

      navigate(location.state?.from || "/", { replace: true });
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 py-8">
      <div className="grid w-full max-w-[1100px] overflow-hidden rounded-[32px] border border-x-border bg-[#090a0c] shadow-lift tablet:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden border-b border-x-border p-8 tablet:border-b-0 tablet:border-r tablet:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(29,155,240,0.22),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(249,24,128,0.12),_transparent_28%)]" />
          <div className="relative">
            <p className="text-[14px] font-bold uppercase tracking-[0.28em] text-x-secondary">Voice Atlas</p>
            <h1 className="mt-6 max-w-xl text-[44px] font-extrabold leading-[1.02] tracking-tight text-x-primary phone:text-[56px]">
              Publish voice-first moments, build threads from audio, and let the transcript catch up after.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-8 text-x-secondary">
              Record or upload audio, trim the clip, and turn each post into a living conversation.
            </p>

            <div className="mt-10 grid gap-3 phone:grid-cols-3">
              {["Voice posts", "Live feed", "Clean playback"].map((item) => (
                <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-5 text-[15px] font-semibold text-x-primary" key={item}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="p-8 tablet:p-12">
          <p className="text-[31px] font-extrabold leading-8 text-x-primary">{isRegister ? "Create your account" : "Sign in to Voice Atlas"}</p>
          <p className="mt-3 text-[15px] leading-6 text-x-secondary">
            {isRegister ? "Join the feed, publish voice posts, and start building your profile." : "Pick up where you left off."}
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            {isRegister ? (
              <label className="block">
                <span className="mb-2 block text-[15px] font-medium text-x-primary">Username</span>
                <input
                  className="x-input rounded-2xl"
                  onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                  placeholder="voicepilot"
                  required
                  type="text"
                  value={form.username}
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-[15px] font-medium text-x-primary">Email</span>
              <input
                className="x-input rounded-2xl"
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="hello@voice-tweet.com"
                required
                type="email"
                value={form.email}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[15px] font-medium text-x-primary">Password</span>
              <input
                className="x-input rounded-2xl"
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="At least 8 characters"
                required
                type="password"
                value={form.password}
              />
            </label>

            {error ? <p className="rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100">{error}</p> : null}

            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[16px] font-bold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : null}
              {busy ? "Working..." : isRegister ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-[15px] text-x-secondary">
            {isRegister ? "Already have an account?" : "Need an account?"}{" "}
            <Link className="font-bold text-white" to={isRegister ? "/login" : "/register"}>
              {isRegister ? "Sign in" : "Create one"}
            </Link>
          </p>
        </section>
      </div>
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
      setSearchState(nextSearch);

      const params = new URLSearchParams(location.search);
      if (nextSearch.length) {
        params.set("q", nextSearch);
      } else {
        params.delete("q");
      }

      navigate(
        {
          pathname: location.pathname,
          search: params.toString() ? `?${params.toString()}` : "",
        },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  useNetworkToasts();

  return (
    <Routes>
      <Route element={Routed(<AuthPage mode="login" />)} path="/login" />
      <Route element={Routed(<AuthPage mode="register" />)} path="/register" />
      <Route element={Routed(<HomeRoute search={search} setSearch={setSearch} />)} path="/" />
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
