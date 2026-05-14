import { ArrowLeft, Shield } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError, apiFetch, getMediaUrl } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import PostCard from "./PostCard.jsx";
import SafetyMenu from "./SafetyMenu.jsx";

export function usePublicProfileHighlights(profile) {
  return useMemo(() => {
    if (!profile?.tweets?.length) {
      return [];
    }

    return profile.tweets.slice(0, 3).map((tweet, index) => ({
      title: tweet.caption || tweet.transcription_text?.split("\n")[0] || `${tweet.user.username} опубликовал запись`,
      meta: index === 0 ? "Запись автора" : "Недавний пост",
      count: `${tweet.reply_count || 0} ответов`,
    }));
  }, [profile?.tweets]);
}

export default function PublicProfilePage() {
  const { user } = useAuth();
  const { profileId } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [followBusy, setFollowBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch(`/users/${profileId}`);
      setProfile(data);
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось загрузить этот профиль.");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profile?.user?.is_self) {
      navigate("/profile", { replace: true });
    }
  }, [navigate, profile?.user?.is_self]);

  const toggleFollow = async () => {
    if (!user || !profile) {
      showToast("Войдите, чтобы подписаться на автора.", "info");
      return;
    }

    const nextFollowing = !profile.user.is_following;

    try {
      setFollowBusy(true);
      const result = await apiFetch(`/users/${profile.user.id}/follow`, {
        method: nextFollowing ? "POST" : "DELETE",
      });
      setProfile((current) =>
        current
          ? {
              ...current,
              user: {
                ...current.user,
                is_following: result.is_following,
              },
              follower_count: result.follower_count,
            }
          : current,
      );
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось обновить подписку.", "info");
    } finally {
      setFollowBusy(false);
    }
  };

  const avatarUrl = profile?.user?.avatar_url ? getMediaUrl(profile.user.avatar_url) : "";

  return (
    <section>
      <header className="top-app-bar">
        <div className="top-app-bar__inner page-header-bar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button aria-label="Go back" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={() => navigate(-1)} type="button">
              <ArrowLeft size={18} />
            </button>
            <div>
              <p className="m3-section-label">Профиль</p>
              <h1 className="top-app-bar__title m3-break-anywhere" style={{ fontSize: 22 }}>
                {profile?.user?.username || "Профиль"}
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
              {avatarUrl ? (
                <img alt={profile?.user?.username || "Аватар"} src={avatarUrl} style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--md-sys-color-outline)" }} />
              ) : (
                <div className="m3-avatar" style={{ width: 72, height: 72, fontSize: 24 }}>
                  {(profile?.user?.username || "VA").slice(0, 2).toUpperCase()}
                </div>
              )}

              <div className="profile-hero__identity">
                <div className="profile-hero__headline">
                  <p className="m3-title-medium profile-hero__name">
                    {profile?.user?.username}
                  </p>
                  {String(profile?.user?.role || "").toLowerCase() === "admin" ? <Shield size={16} style={{ color: "var(--md-sys-color-primary)" }} /> : null}
                </div>
                <p className="m3-body-small profile-hero__handle">
                  @{(profile?.user?.username || "").toLowerCase()}
                </p>
                <p className="profile-hero__bio">
                  {profile?.user?.bio || "Автор голосовых записей."}
                </p>
              </div>
            </div>

            {profile?.user ? (
              <div className="profile-hero__actions">
                {user ? (
                  <button
                    className={[
                      "m3-button",
                      profile.user.is_following ? "m3-button-outlined" : "m3-button-filled",
                      "m3-interactive",
                    ].join(" ")}
                    disabled={followBusy}
                    onClick={() => void toggleFollow()}
                    type="button"
                  >
                    {followBusy ? "Обновление\u2026" : profile.user.is_following ? "Вы подписаны" : "Подписаться"}
                  </button>
                ) : null}
                <SafetyMenu onActionComplete={() => void loadProfile()} targetUserId={profile.user.id} targetUsername={profile.user.username} />
              </div>
            ) : null}
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
              {new Date(profile?.user?.created_at || Date.now()).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
            </span>
          </div>
        </section>

        {error ? <p className="m3-error">{error}</p> : null}

        {loading && !profile ? (
          <div className="post-list">
            {[0, 1, 2].map((item) => (
              <div className="m3-card" key={item} style={{ padding: 18 }}>
                <div className="m3-skeleton" style={{ height: 110 }} />
              </div>
            ))}
          </div>
        ) : profile?.tweets?.length ? (
          <div className="post-list">
            {profile.tweets.map((tweet) => (
              <PostCard currentUser={user} key={tweet.id} onRefreshRequested={() => void loadProfile()} tweet={tweet} />
            ))}
          </div>
        ) : (
          <div className="m3-card m3-empty empty-state-card">
            <p className="m3-section-label">Пока тихо</p>
            <p className="m3-title-medium empty-state-card__title">Пока нет записей</p>
            <p className="m3-body-small empty-state-card__description" style={{ marginTop: 6 }}>
              Этот автор ещё ничего не опубликовал. Загляните позже или вернитесь в ленту.
            </p>
            <div className="empty-state-card__actions">
              <Link className="m3-button m3-button-outlined m3-interactive" to="/">
                Вернуться в ленту
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
