import { ArrowLeft, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError, apiFetch, createEventSource } from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import PostCard from "./PostCard.jsx";
import PostComposer from "./PostComposer.jsx";

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
    title: tweet.caption || tweet.transcription_text?.split("\n")[0] || `${tweet.user.username} posted audio`,
    meta: index === 0 ? "Thread anchor" : "Voice reply",
    count: `${tweet.reply_count || 0} replies`,
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
        setError(caughtError instanceof ApiError ? caughtError.message : "Unable to load the thread.");
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
      showToast("Transcript updated.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to update the transcript.", "info");
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
      const updatedTweet = await apiFetch(`/tweets/${detail.tweet.id}/rerun-transcription`, {
        method: "POST",
      });
      setDetail((current) => (current ? { ...current, tweet: updatedTweet } : current));
      showToast("Whisper re-run started.", "success");
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to rerun transcription.", "info");
    } finally {
      setEditingBusy(false);
    }
  };

  if (loading && !detail) {
    return (
      <section>
        <header className="sticky top-0 z-20 border-b border-x-border bg-black/80 backdrop-blur-md">
          <div className="flex items-center gap-4 px-4 py-3 phone:px-5">
            <button aria-label="Go back" className="x-icon-button h-9 w-9" onClick={() => navigate(-1)} type="button">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <p className="text-[20px] font-extrabold text-x-primary">Thread</p>
          </div>
        </header>
        <div className="px-4 py-8 phone:px-5">
          <div className="rounded-[24px] border border-x-border bg-[#111214] p-6 text-[15px] text-x-secondary">Loading thread...</div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <header className="sticky top-0 z-20 border-b border-x-border bg-black/80 backdrop-blur-md">
        <div className="flex items-center gap-4 px-4 py-3 phone:px-5">
          <button aria-label="Go back" className="x-icon-button h-9 w-9" onClick={() => navigate(-1)} type="button">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-[20px] font-extrabold text-x-primary">Thread</p>
            <p className="text-[13px] text-x-secondary">Permalink, replies, and transcript controls.</p>
          </div>
        </div>
      </header>

      {error ? <p className="mx-4 mt-4 rounded-2xl border border-x-red/35 bg-x-red/10 px-4 py-3 text-[14px] text-red-100 phone:mx-5">{error}</p> : null}

      {detail?.parent ? (
        <div className="border-b border-x-border bg-white/[0.015]">
          <div className="px-4 py-3 phone:px-5">
            <p className="text-[13px] font-medium text-x-secondary">
              In reply to{" "}
              <Link className="text-x-blue" to={`/profile/${detail.parent.user.id}`}>
                @{detail.parent.user.username.toLowerCase()}
              </Link>
            </p>
          </div>
          <PostCard currentUser={user} onRefreshRequested={() => void loadThread({ silent: true })} tweet={detail.parent} />
        </div>
      ) : null}

      {detail?.tweet ? <PostCard currentUser={user} onRefreshRequested={() => void loadThread({ silent: true })} tweet={detail.tweet} /> : null}

      {canEditTranscript ? (
        <section className="border-b border-x-border px-4 py-5 phone:px-5">
          <div className="rounded-[24px] border border-white/10 bg-[#0f1115] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[20px] font-extrabold text-x-primary">Transcript studio</p>
                <p className="mt-1 text-[14px] leading-6 text-x-secondary">
                  Edit the transcript manually when Whisper misses context, or rerun it from the source audio.
                </p>
              </div>
              <span className="x-pill">
                <Sparkles className="h-3.5 w-3.5" />
                Voice-first editing
              </span>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 block text-[14px] font-semibold text-x-primary">Transcript text</span>
              <textarea
                className="x-input min-h-[180px] rounded-[22px]"
                maxLength={5000}
                onChange={(event) => setTranscriptionDraft(event.target.value)}
                placeholder="Refine the transcript, clean up filler words, or add missing context."
                value={transcriptionDraft}
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-[15px] font-bold text-x-primary transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={editingBusy}
                onClick={() => void rerunTranscription()}
                type="button"
              >
                <RotateCcw className="h-[18px] w-[18px]" />
                Re-run transcription
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-full bg-x-blue px-5 py-2.5 text-[15px] font-bold text-white transition hover:bg-[#1a8cd8] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={editingBusy}
                onClick={() => void saveTranscript()}
                type="button"
              >
                {editingBusy ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : null}
                Save transcript
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="border-b border-x-border px-4 py-5 phone:px-5">
        {user ? (
          <PostComposer onCreated={() => void loadThread({ silent: true })} replyToTweetId={detail?.tweet?.id || null} user={user} />
        ) : (
          <div className="rounded-[24px] border border-x-border bg-[#111214] p-6">
            <p className="text-[24px] font-extrabold text-x-primary">Reply with your voice</p>
            <p className="mt-2 text-[15px] leading-6 text-x-secondary">Sign in to leave an audio reply and keep the thread moving.</p>
            <div className="mt-4 flex gap-3">
              <Link className="rounded-full bg-white px-5 py-2.5 text-[15px] font-bold text-black transition hover:bg-white/90" to="/login">
                Sign in
              </Link>
              <Link className="rounded-full border border-x-border px-5 py-2.5 text-[15px] font-bold text-x-primary transition hover:bg-x-hover" to="/register">
                Create account
              </Link>
            </div>
          </div>
        )}
      </section>

      {detail?.replies?.length ? (
        detail.replies.map((reply) => (
          <PostCard
            currentUser={user}
            key={reply.id}
            onRefreshRequested={() => void loadThread({ silent: true })}
            tweet={reply}
          />
        ))
      ) : (
        <div className="px-4 py-10 phone:px-5">
          <div className="rounded-[24px] border border-x-border bg-[#111214] p-6">
            <p className="text-[24px] font-extrabold text-x-primary">No replies yet</p>
            <p className="mt-2 text-[15px] leading-6 text-x-secondary">This permalink is live. The first audio reply will appear right here.</p>
          </div>
        </div>
      )}
    </section>
  );
}
