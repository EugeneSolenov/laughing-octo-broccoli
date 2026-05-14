import { ArrowLeft, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError, apiFetch, createEventSource } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import PostCard from "./PostCard.jsx";

const LIVE_THREAD_EVENTS = new Set([
  "tweet.created",
  "tweet.deleted",
  "tweet.engagement_updated",
  "tweet.transcription_updated",
  "tweet.reply_created",
]);

function buildThreadHighlights(detail) {
  const items = [detail?.parent, detail?.tweet, ...(detail?.replies || [])].filter(Boolean);
  if (!items.length) {
    return [];
  }

  return items.slice(0, 3).map((tweet, index) => ({
    title: tweet.caption || tweet.transcription_text?.split("\n")[0] || `${tweet.user.username} опубликовал запись`,
    meta: index === 0 ? "Главная запись" : "Ответ",
    count: `${tweet.reply_count || 0} ответов`,
  }));
}

export function useThreadHighlights(detail) {
  return useMemo(() => buildThreadHighlights(detail), [detail]);
}

export default function PostThreadPage() {
  const { user } = useAuth();
  const { postId } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [detail, setDetail] = useState(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [transcriptionDraft, setTranscriptionDraft] = useState("");

  const loadThread = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (!silent) {
          setLoading(true);
        }
        const data = await apiFetch(`/tweets/${postId}`);
        setDetail(data);
        setError("");
      } catch (caughtError) {
        setError(caughtError instanceof ApiError ? caughtError.message : "Не удалось загрузить обсуждение.");
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [postId],
  );

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  useEffect(() => {
    setTranscriptionDraft(detail?.tweet?.transcription_text || "");
  }, [detail?.tweet?.id, detail?.tweet?.transcription_text]);

  useEffect(() => {
    const eventSource = createEventSource("/events/stream");

    const handleEvent = (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!LIVE_THREAD_EVENTS.has(payload.type)) {
        return;
      }

      const targetId = Number(postId);
      const relatedIds = new Set([targetId, detail?.tweet?.parent_tweet_id, ...(detail?.replies || []).map((reply) => reply.id)]);
      if (payload.tweet_id && relatedIds.has(payload.tweet_id)) {
        void loadThread({ silent: true });
        return;
      }
      if (payload.reply_id && relatedIds.has(payload.reply_id)) {
        void loadThread({ silent: true });
      }
    };

    [...LIVE_THREAD_EVENTS].forEach((eventType) => eventSource.addEventListener(eventType, handleEvent));

    return () => {
      [...LIVE_THREAD_EVENTS].forEach((eventType) => eventSource.removeEventListener(eventType, handleEvent));
      eventSource.close();
    };
  }, [detail?.replies, detail?.tweet?.parent_tweet_id, loadThread, postId]);

  const canEditTranscript =
    Boolean(user && detail?.tweet) &&
    (String(user.role || "").toLowerCase() === "admin" || user.id === detail.tweet.user.id);

  const saveTranscript = async () => {
    if (!detail?.tweet) {
      return;
    }

    try {
      setEditingBusy(true);
      const updatedTweet = await apiFetch(`/tweets/${detail.tweet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcription_text: transcriptionDraft.trim() || null }),
      });
      setDetail((current) => (current ? { ...current, tweet: updatedTweet } : current));
      showToast("Транскрипция обновлена.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось обновить транскрипцию.", "info");
    } finally {
      setEditingBusy(false);
    }
  };

  const rerunTranscription = async () => {
    if (!detail?.tweet) {
      return;
    }

    try {
      setEditingBusy(true);
      const updatedTweet = await apiFetch(`/tweets/${detail.tweet.id}/rerun-transcription`, { method: "POST" });
      setDetail((current) => (current ? { ...current, tweet: updatedTweet } : current));
      showToast("Повторная расшифровка запущена.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось повторно запустить транскрипцию.", "info");
    } finally {
      setEditingBusy(false);
    }
  };

  const submitComment = async (event) => {
    event.preventDefault();

    const normalizedComment = commentText.trim();
    if (!detail?.tweet || detail.tweet.parent_tweet_id || !normalizedComment) {
      return;
    }

    try {
      setCommentBusy(true);
      const formData = new FormData();
      formData.append("caption", normalizedComment);
      await apiFetch(`/tweets/${detail.tweet.id}/reply`, {
        method: "POST",
        body: formData,
      });
      setCommentText("");
      await loadThread({ silent: true });
      showToast("Комментарий отправлен.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Не удалось отправить комментарий.", "info");
    } finally {
      setCommentBusy(false);
    }
  };

  const isReplyThread = Boolean(detail?.tweet?.parent_tweet_id);
  const canCommentOnThread = Boolean(user && detail?.tweet && !isReplyThread);
  const shouldShowLoginCommentPrompt = Boolean(!user && detail?.tweet && !isReplyThread);
  const isCommentDisabled = commentBusy || !commentText.trim().length;

  return (
    <section>
      <header className="top-app-bar">
        <div className="top-app-bar__inner">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button aria-label="Назад" className="m3-icon-button m3-icon-button--outlined m3-interactive" onClick={() => navigate(-1)} type="button">
              <ArrowLeft size={18} />
            </button>
            <div>
              <p className="m3-section-label">Обсуждение</p>
              <h1 className="top-app-bar__title" style={{ fontSize: 22 }}>
                Ветка
              </h1>
            </div>
          </div>
          <p className="m3-body-small">{detail?.replies?.length || 0} ответов</p>
        </div>
      </header>

      <div className="main-page-stack">
        {error ? <p className="m3-error">{error}</p> : null}

        {loading && !detail ? (
          <div className="m3-card" style={{ padding: 18 }}>
            <div className="m3-skeleton" style={{ height: 110 }} />
          </div>
        ) : null}

        {detail?.parent ? (
          <section className="m3-panel" style={{ padding: 18 }}>
            <p className="m3-body-small" style={{ marginBottom: 12 }}>
              Ответ для{" "}
              <Link className="m3-link" to={`/profile/${detail.parent.user.id}`}>
                @{detail.parent.user.username.toLowerCase()}
              </Link>
            </p>
            <PostCard currentUser={user} onRefreshRequested={() => void loadThread({ silent: true })} tweet={detail.parent} />
          </section>
        ) : null}

        {detail?.tweet ? <PostCard currentUser={user} onRefreshRequested={() => void loadThread({ silent: true })} tweet={detail.tweet} /> : null}

        {canEditTranscript ? (
          <section className="m3-panel" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
              <div>
                <p className="m3-section-label">Инструменты транскрипции</p>
                <h2 className="m3-title-medium" style={{ marginTop: 4, fontSize: 20 }}>
                  Уточнить текст от ИИ
                </h2>
                <p className="m3-body-small" style={{ marginTop: 6 }}>
                  Исправьте формулировки вручную или запустите распознавание заново на исходном аудио.
                </p>
              </div>
              <span className="m3-chip m3-chip-filled">
                <Sparkles size={12} />
                ИИ
              </span>
            </div>

            <label style={{ display: "grid", gap: 8 }}>
              <span className="m3-title-medium" style={{ fontSize: 14 }}>
                Транскрипция
              </span>
              <textarea
                className="m3-textarea"
                maxLength={5000}
                onChange={(event) => setTranscriptionDraft(event.target.value)}
                placeholder="Исправьте текст, уберите слова-паразиты или добавьте недостающий контекст."
                rows={6}
                value={transcriptionDraft}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
              <button className="m3-button m3-button-outlined m3-interactive" disabled={editingBusy} onClick={() => void rerunTranscription()} type="button">
                <RotateCcw size={14} />
                Запустить ещё раз
              </button>
              <button className="m3-button m3-button-filled m3-fab m3-interactive" disabled={editingBusy} onClick={() => void saveTranscript()} type="button">
                {editingBusy ? <LoaderCircle size={14} style={{ animation: "spin 1s linear infinite" }} /> : null}
                Сохранить
              </button>
            </div>
          </section>
        ) : null}

        {canCommentOnThread ? (
          <section className="m3-panel" style={{ padding: 20 }}>
            <form className="thread-comment-form" onSubmit={submitComment}>
              <div className="thread-comment-form__header">
                <div>
                  <p className="m3-section-label">Комментарий</p>
                  <h2 className="m3-title-medium" style={{ marginTop: 4, fontSize: 20 }}>
                    Ответить текстом
                  </h2>
                </div>
                <span className="m3-body-small">{commentText.length}/500</span>
              </div>
              <textarea
                className="m3-textarea thread-comment-form__textarea"
                maxLength={500}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="Написать комментарий..."
                rows={4}
                value={commentText}
              />
              <div className="thread-comment-form__actions">
                <button className="m3-button m3-button-filled m3-fab m3-interactive" disabled={isCommentDisabled} type="submit">
                  {commentBusy ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> : null}
                  {commentBusy ? "Отправка\u2026" : "Отправить"}
                </button>
              </div>
            </form>
          </section>
        ) : shouldShowLoginCommentPrompt ? (
          <section className="m3-panel" style={{ padding: 20 }}>
            <div className="m3-card m3-empty">
              <p className="m3-title-medium">Только авторизованные пользователи могут комментировать</p>
              <p className="m3-body-small" style={{ marginTop: 6 }}>
                Войдите, чтобы оставить текстовый комментарий в этой ветке.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                <Link className="m3-button m3-button-filled m3-fab m3-interactive" to="/login">
                  Войти
                </Link>
                <Link className="m3-button m3-button-outlined m3-interactive" to="/register">
                  Создать аккаунт
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {detail?.replies?.length ? (
          <div className="post-list">
            {detail.replies.map((reply) => (
              <PostCard currentUser={user} key={reply.id} onRefreshRequested={() => void loadThread({ silent: true })} tweet={reply} />
            ))}
          </div>
        ) : (
          !loading &&
          !isReplyThread && (
            <div className="m3-card m3-empty">
              <p className="m3-title-medium">Ответов пока нет</p>
              <p className="m3-body-small" style={{ marginTop: 6 }}>
                Оставьте первый комментарий к этой записи.
              </p>
            </div>
          )
        )}
      </div>
    </section>
  );
}
