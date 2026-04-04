import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, CheckCheck, LoaderCircle, MessageCircle, Repeat2, UserPlus, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiFetch, getMediaUrl } from "../api/client";

function formatNotificationDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function NotificationIcon({ type }) {
  if (type === "follow") return <UserPlus className="h-5 w-5" />;
  if (type === "repost") return <Repeat2 className="h-5 w-5" />;
  if (type === "reply") return <MessageCircle className="h-5 w-5" />;
  if (type === "transcription_ready") return <Volume2 className="h-5 w-5" />;
  return <Bell className="h-5 w-5" />;
}

export default function NotificationSheet({ onClose, onUnreadCountChange, open, refreshToken }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let cancelled = false;

    const loadNotifications = async () => {
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
        if (cancelled) {
          return;
        }
        setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load notifications.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadNotifications();

    return () => {
      cancelled = true;
    };
  }, [onUnreadCountChange, open, refreshToken]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.is_read).length, [notifications]);

  const markAllRead = async () => {
    try {
      setMarkingRead(true);
      await apiFetch("/notifications/read-all", { method: "POST" });
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
      onUnreadCountChange?.(0);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to mark notifications as read.");
    } finally {
      setMarkingRead(false);
    }
  };

  const markSingleRead = async (notificationId) => {
    try {
      const result = await apiFetch(`/notifications/${notificationId}/read`, { method: "POST" });
      setNotifications((current) => current.map((item) => (item.id === notificationId ? { ...item, is_read: true } : item)));
      onUnreadCountChange?.(result.unread_count);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Unable to update notification.");
    }
  };

  const openNotification = async (notification) => {
    if (!notification.is_read) {
      await markSingleRead(notification.id);
    }

    const targetPath =
      notification.path ||
      (notification.tweet_id ? `/post/${notification.tweet_id}` : notification.actor ? `/profile/${notification.actor.id}` : "/profile");

    navigate(targetPath);
    onClose?.();
  };

  const openActorProfile = async (notification) => {
    if (!notification.actor) {
      return;
    }
    if (!notification.is_read) {
      await markSingleRead(notification.id);
    }
    navigate(`/profile/${notification.actor.id}`);
    onClose?.();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 bg-black/75 px-4 py-6 backdrop-blur-sm"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="mx-auto max-w-[680px] overflow-hidden rounded-[24px] border border-white/10 bg-[#090b0f]"
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[20px] font-extrabold text-x-primary">Notifications</p>
                <p className="text-[13px] text-x-secondary">Replies, follows, reposts, and AI status updates.</p>
              </div>
              <button aria-label="Close notifications" className="x-icon-button h-10 w-10" onClick={onClose} type="button">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <p className="text-[14px] text-x-secondary">{unreadCount} unread</p>
              <button
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[14px] font-bold text-x-primary transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={markingRead || !unreadCount}
                onClick={() => void markAllRead()}
                type="button"
              >
                {markingRead ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                Mark all read
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto">
              {loading ? (
                <div className="px-5 py-8 text-[15px] text-x-secondary">Loading notifications...</div>
              ) : error ? (
                <div className="px-5 py-6">
                  <p className="rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100">{error}</p>
                </div>
              ) : notifications.length ? (
                notifications.map((notification) => (
                  <article
                    className={[
                      "border-b border-white/5 px-5 py-4 transition",
                      notification.is_read ? "bg-black" : "bg-white/[0.025]",
                    ].join(" ")}
                    key={notification.id}
                  >
                    <div className="flex gap-3">
                      <button
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1d9bf0]/15 text-x-blue"
                        onClick={() => void openNotification(notification)}
                        type="button"
                      >
                        <NotificationIcon type={notification.type} />
                      </button>
                      <div className="min-w-0 flex-1">
                        {notification.actor ? (
                          <button className="flex items-center gap-2 text-left" onClick={() => void openActorProfile(notification)} type="button">
                            {notification.actor.avatar_url ? (
                              <img
                                alt={notification.actor.username}
                                className="h-8 w-8 rounded-full object-cover"
                                src={getMediaUrl(notification.actor.avatar_url)}
                              />
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1d9bf0]/15 text-[11px] font-bold text-x-blue">
                                {notification.actor.username.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <p className="text-[13px] font-semibold text-x-secondary">@{notification.actor.username.toLowerCase()}</p>
                          </button>
                        ) : null}
                        <button className="w-full text-left" onClick={() => void openNotification(notification)} type="button">
                          <p className="text-[15px] leading-6 text-x-primary">{notification.message}</p>
                          {notification.tweet_preview ? <p className="mt-1 text-[13px] leading-5 text-x-secondary">"{notification.tweet_preview}"</p> : null}
                          <p className="mt-1 text-[13px] text-x-secondary">{formatNotificationDate(notification.created_at)}</p>
                        </button>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {notification.tweet_id ? (
                            <button
                              className="rounded-full border border-white/10 px-3 py-1.5 text-[13px] font-semibold text-x-primary transition hover:bg-white/[0.04]"
                              onClick={() => void openNotification(notification)}
                              type="button"
                            >
                              Open post
                            </button>
                          ) : null}
                          {notification.actor ? (
                            <button
                              className="rounded-full border border-white/10 px-3 py-1.5 text-[13px] font-semibold text-x-primary transition hover:bg-white/[0.04]"
                              onClick={() => void openActorProfile(notification)}
                              type="button"
                            >
                              View profile
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {!notification.is_read ? (
                        <button
                          aria-label="Mark notification as read"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-x-secondary transition hover:bg-white/[0.04] hover:text-x-primary"
                          onClick={() => void markSingleRead(notification.id)}
                          type="button"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))
              ) : (
                <div className="px-5 py-10 text-center">
                  <p className="text-[24px] font-extrabold text-x-primary">Nothing new yet</p>
                  <p className="mt-2 text-[15px] leading-6 text-x-secondary">When someone replies, follows you, or interacts with your clips, it will show up here.</p>
                </div>
              )}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
