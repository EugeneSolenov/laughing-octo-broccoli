import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, CheckCheck, LoaderCircle, MessageCircle, ThumbsDown, UserPlus, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiFetch, getMediaUrl } from "../api/client";
import { buildAvatarTone, getAvatarInitials } from "../utils/avatar.js";

function formatDate(value) {
  const date = new Date(value);
  const datePart = new Intl.DateTimeFormat("ru-RU", {
    month: "short",
    day: "numeric",
  }).format(date);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${datePart}, ${hours}:${minutes}`;
}

function NotificationIcon({ type }) {
  const commonProps = { size: 20, strokeWidth: 1.8 };
  if (type === "follow") {
    return <UserPlus {...commonProps} />;
  }
  if (type === "repost") {
    return <ThumbsDown {...commonProps} />;
  }
  if (type === "reply") {
    return <MessageCircle {...commonProps} />;
  }
  if (type === "transcription_ready") {
    return <Volume2 {...commonProps} />;
  }
  return <Bell {...commonProps} />;
}

export default function NotificationSheet({ onClose, onUnreadCountChange, open, refreshToken }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const data = await apiFetch("/notifications");
        if (cancelled) {
          return;
        }
        setNotifications(data.items);
        onUnreadCountChange?.(data.unread_count);
        setError("");
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось загрузить уведомления.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onUnreadCountChange, open, refreshToken]);

  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.is_read).length, [notifications]);

  const markAllRead = async () => {
    try {
      setMarkingAll(true);
      await apiFetch("/notifications/read-all", { method: "POST" });
      setNotifications((current) => current.map((notification) => ({ ...notification, is_read: true })));
      onUnreadCountChange?.(0);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось отметить уведомления как прочитанные.");
    } finally {
      setMarkingAll(false);
    }
  };

  const markOneRead = async (notificationId) => {
    try {
      const result = await apiFetch(`/notifications/${notificationId}/read`, { method: "POST" });
      setNotifications((current) =>
        current.map((notification) => (notification.id === notificationId ? { ...notification, is_read: true } : notification)),
      );
      onUnreadCountChange?.(result.unread_count);
    } catch {
      // Ignore single notification read failures.
    }
  };

  const openNotification = async (notification) => {
    if (!notification.is_read) {
      await markOneRead(notification.id);
    }

    navigate(notification.path || (notification.tweet_id ? `/post/${notification.tweet_id}` : notification.actor ? `/profile/${notification.actor.id}` : "/profile"));
    onClose?.();
  };

  const openActor = async (notification) => {
    if (!notification.actor) {
      return;
    }

    if (!notification.is_read) {
      await markOneRead(notification.id);
    }

    navigate(`/profile/${notification.actor.id}`);
    onClose?.();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div animate={{ opacity: 1 }} className="m3-overlay" exit={{ opacity: 0 }} initial={{ opacity: 0 }} onClick={onClose}>
          <motion.section
            animate={{ opacity: 1, y: 0, scale: 1 }}
            aria-label="Уведомления"
            aria-modal="true"
            className="m3-sheet"
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="dialog-header">
              <div>
                <p className="m3-section-label">Активность</p>
                <h2 className="m3-title-medium" style={{ marginTop: 4, fontSize: 20 }}>
                  Уведомления
                </h2>
                <p className="m3-body-small" style={{ marginTop: 6 }}>
                  Непрочитано: {unreadCount}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="m3-button m3-button-outlined m3-interactive" disabled={markingAll || !unreadCount} onClick={() => void markAllRead()} type="button">
                  {markingAll ? <LoaderCircle size={14} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCheck size={14} />}
                  Отметить всё
                </button>
                <button aria-label="Закрыть уведомления" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={onClose} type="button">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="notification-list" aria-live="polite" aria-relevant="additions" role="log">
              {loading ? (
                <div style={{ padding: 24 }}>
                  <div className="m3-skeleton" style={{ height: 72 }} />
                </div>
              ) : error ? (
                <div style={{ padding: 20 }}>
                  <p className="m3-error">{error}</p>
                </div>
              ) : notifications.length ? (
                notifications.map((notification) => (
                  <article className={["notification-item", notification.is_read ? "is-read" : "is-unread"].join(" ")} key={notification.id}>
                    <div className="notification-type-icon notification-item__icon">
                      <NotificationIcon type={notification.type} />
                    </div>

                    <div className="notification-user notification-item__content">
                      {notification.actor ? (
                        <button className="m3-interactive notification-item__actor" onClick={() => void openActor(notification)} type="button">
                          {notification.actor.avatar_url ? (
                            <img alt={notification.actor.username} className="notification-item__avatar-image" src={getMediaUrl(notification.actor.avatar_url)} />
                          ) : (
                            <div className="notification-item__avatar" style={buildAvatarTone(notification.actor.username)}>
                              {getAvatarInitials(notification.actor.username)}
                            </div>
                          )}
                          <span className="m3-body-small notification-username notification-item__actor-name">@{notification.actor.username}</span>
                        </button>
                      ) : null}

                      <button className="m3-interactive notification-item__message-button" onClick={() => void openNotification(notification)} type="button">
                        <p className="notification-item__message">{notification.message}</p>
                        {notification.tweet_preview ? <p className="m3-body-small notification-item__preview">“{notification.tweet_preview}”</p> : null}
                        <p className="m3-body-small notification-item__meta">{formatDate(notification.created_at)}</p>
                      </button>

                      <div className="notification-item__actions">
                        {notification.tweet_id ? (
                          <button className="m3-button m3-button-outlined m3-interactive" onClick={() => void openNotification(notification)} type="button">
                            Открыть запись
                          </button>
                        ) : null}
                        {notification.actor ? (
                          <button className="m3-button m3-button-outlined m3-interactive" onClick={() => void openActor(notification)} type="button">
                            Открыть профиль
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <button
                      aria-label={notification.is_read ? "Прочитано" : "Отметить как прочитанное"}
                      className={["notification-read-btn", "notification-item__read-state", notification.is_read ? "is-read" : "is-unread", notification.is_read ? "" : "m3-interactive"].join(" ")}
                      disabled={notification.is_read}
                      onClick={() => (!notification.is_read ? void markOneRead(notification.id) : undefined)}
                      type="button"
                    >
                      {notification.is_read ? <Check size={16} strokeWidth={2} /> : null}
                    </button>
                  </article>
                ))
              ) : (
                <div style={{ padding: 28 }}>
                  <div className="m3-card m3-empty notification-empty-state">
                    <p className="m3-title-medium">Пока пусто</p>
                    <p className="m3-body-small" style={{ marginTop: 6 }}>
                      Здесь появятся ответы, подписки, реакции и готовые транскрипции. Опубликуйте запись или найдите авторов, чтобы лента начала оживать.
                    </p>
                    <div className="notification-empty-state__actions">
                      <button
                        className="m3-button m3-button-filled m3-fab m3-interactive"
                        onClick={() => {
                          navigate("/");
                          onClose?.();
                        }}
                        type="button"
                      >
                        Перейти в ленту
                      </button>
                      <button
                        className="m3-button m3-button-outlined m3-interactive"
                        onClick={() => {
                          navigate("/search");
                          onClose?.();
                        }}
                        type="button"
                      >
                        Найти авторов
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
