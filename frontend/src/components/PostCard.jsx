import { AnimatePresence, motion } from "framer-motion";
import { Heart, MessageCircle, Pause, Play, Repeat2, RotateCcw, Share, Shield, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, apiFetch, getMediaUrl } from "../api/client";
import SafetyMenu from "./SafetyMenu.jsx";
import { useToast } from "../context/ToastContext.jsx";

const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2];
const SIMULATED_TRANSCRIPTION = "AI is still preparing the transcript. Check back in a moment or open the thread to refresh.";

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) {
    return "0:00";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTimestamp(value) {
  const date = new Date(value);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) {
    return "now";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  if (minutes < 1440) {
    return `${Math.floor(minutes / 60)}h`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function buildLeadCopy(tweet) {
  if (tweet.caption?.trim()) {
    return tweet.caption.trim();
  }
  if (tweet.transcription_text?.trim()) {
    return tweet.transcription_text.trim().split("\n")[0];
  }
  if (tweet.status === "error") {
    return "This clip hit a transcription error. Open the thread to edit the transcript or retry AI.";
  }
  if (tweet.parent_tweet_id) {
    return "Audio reply in this thread.";
  }
  return "Play the clip, share the link, and follow the conversation from the thread view.";
}

function HeartBurst({ active }) {
  return (
    <AnimatePresence>
      {active ? (
        <motion.span
          animate={{ opacity: 1, scale: 1 }}
          className="pointer-events-none absolute inset-0"
          exit={{ opacity: 0, scale: 1.2 }}
          initial={{ opacity: 0, scale: 0.4 }}
        >
          {[0, 1, 2, 3, 4, 5].map((index) => {
            const angle = (Math.PI * 2 * index) / 6;
            const x = Math.cos(angle) * 16;
            const y = Math.sin(angle) * 16;

            return (
              <motion.span
                animate={{ opacity: [1, 0], x: [0, x], y: [0, y], scale: [0.6, 1.15] }}
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-x-pink"
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
                key={index}
                style={{ marginLeft: -3, marginTop: -3 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              />
            );
          })}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

export default function PostCard({ currentUser, onDeleted, onRefreshRequested, tweet }) {
  const navigate = useNavigate();
  const showToast = useToast();
  const audioRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [repostBusy, setRepostBusy] = useState(false);
  const [showBurst, setShowBurst] = useState(false);
  const [showSimulation, setShowSimulation] = useState(Boolean(tweet.client_simulated && tweet.status === "processing"));
  const [speedIndex, setSpeedIndex] = useState(0);
  const [engagement, setEngagement] = useState({
    isLiked: Boolean(tweet.liked_by_viewer),
    isReposted: Boolean(tweet.reposted_by_viewer),
    likeCount: tweet.likes_count || 0,
    repostCount: tweet.reposts_count || 0,
  });
  const [isFollowingAuthor, setIsFollowingAuthor] = useState(Boolean(tweet.user.is_following));

  const audioUrl = getMediaUrl(tweet.audio_url);
  const avatarUrl = tweet.user.avatar_url ? getMediaUrl(tweet.user.avatar_url) : "";
  const isAdminAuthor = String(tweet.user.role || "").toLowerCase() === "admin";
  const canDelete = Boolean(currentUser) && (String(currentUser.role || "").toLowerCase() === "admin" || currentUser.id === tweet.user.id);
  const canFollow = Boolean(currentUser) && currentUser.id !== tweet.user.id;
  const threadPath = `/post/${tweet.id}`;

  useEffect(() => {
    setEngagement({
      isLiked: Boolean(tweet.liked_by_viewer),
      isReposted: Boolean(tweet.reposted_by_viewer),
      likeCount: tweet.likes_count || 0,
      repostCount: tweet.reposts_count || 0,
    });
  }, [tweet.id, tweet.liked_by_viewer, tweet.likes_count, tweet.reposted_by_viewer, tweet.reposts_count]);

  useEffect(() => {
    setIsFollowingAuthor(Boolean(tweet.user.is_following));
  }, [tweet.user.id, tweet.user.is_following]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    const handleLoadedMetadata = () => setDuration(audio.duration || 0);
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);
    const handleEnded = () => {
      setCurrentTime(0);
      setIsPlaying(false);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (!(tweet.client_simulated && tweet.status === "processing")) {
      setShowSimulation(false);
      return undefined;
    }

    setShowSimulation(true);
    const timer = window.setTimeout(() => {
      setShowSimulation(false);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [tweet.client_simulated, tweet.status]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  };

  const cycleSpeed = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const nextIndex = (speedIndex + 1) % PLAYBACK_SPEEDS.length;
    audio.playbackRate = PLAYBACK_SPEEDS[nextIndex];
    setSpeedIndex(nextIndex);
  };

  const scrub = (nextTime) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = Number(nextTime);
    setCurrentTime(Number(nextTime));
  };

  const resetPlayer = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = 0;
    audio.pause();
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const deleteTweet = async () => {
    try {
      setDeleting(true);
      setDeleteError("");
      await apiFetch(`/tweets/${tweet.id}`, { method: "DELETE" });
      onDeleted?.(tweet.id);
    } catch (caughtError) {
      setDeleteError(caughtError instanceof ApiError ? caughtError.message : "Unable to delete the post.");
    } finally {
      setDeleting(false);
    }
  };

  const syncFromServerTweet = (updatedTweet) => {
    setEngagement({
      isLiked: Boolean(updatedTweet.liked_by_viewer),
      isReposted: Boolean(updatedTweet.reposted_by_viewer),
      likeCount: updatedTweet.likes_count || 0,
      repostCount: updatedTweet.reposts_count || 0,
    });
    setIsFollowingAuthor(Boolean(updatedTweet.user?.is_following));
  };

  const toggleLike = async () => {
    if (!currentUser) {
      showToast("Sign in to like voice posts.", "info");
      return;
    }

    const nextLiked = !engagement.isLiked;
    setLikeBusy(true);
    setEngagement((current) => ({
      ...current,
      isLiked: nextLiked,
      likeCount: Math.max(0, current.likeCount + (nextLiked ? 1 : -1)),
    }));

    if (nextLiked) {
      setShowBurst(true);
      window.setTimeout(() => setShowBurst(false), 450);
    }

    try {
      const updatedTweet = await apiFetch(`/tweets/${tweet.id}/like`, {
        method: nextLiked ? "POST" : "DELETE",
      });
      syncFromServerTweet(updatedTweet);
    } catch (caughtError) {
      setEngagement((current) => ({
        ...current,
        isLiked: !nextLiked,
        likeCount: Math.max(0, current.likeCount + (nextLiked ? -1 : 1)),
      }));
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to update like.", "info");
    } finally {
      setLikeBusy(false);
    }
  };

  const toggleRepost = async () => {
    if (!currentUser) {
      showToast("Sign in to repost voice posts.", "info");
      return;
    }

    const nextReposted = !engagement.isReposted;
    setRepostBusy(true);
    setEngagement((current) => ({
      ...current,
      isReposted: nextReposted,
      repostCount: Math.max(0, current.repostCount + (nextReposted ? 1 : -1)),
    }));

    try {
      const updatedTweet = await apiFetch(`/tweets/${tweet.id}/repost`, {
        method: nextReposted ? "POST" : "DELETE",
      });
      syncFromServerTweet(updatedTweet);
    } catch (caughtError) {
      setEngagement((current) => ({
        ...current,
        isReposted: !nextReposted,
        repostCount: Math.max(0, current.repostCount + (nextReposted ? -1 : 1)),
      }));
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to update repost.", "info");
    } finally {
      setRepostBusy(false);
    }
  };

  const toggleFollow = async () => {
    if (!canFollow) {
      return;
    }

    const nextFollowing = !isFollowingAuthor;
    try {
      setFollowBusy(true);
      const response = await apiFetch(`/users/${tweet.user.id}/follow`, {
        method: nextFollowing ? "POST" : "DELETE",
      });
      setIsFollowingAuthor(Boolean(response.is_following));
      onRefreshRequested?.();
    } catch (caughtError) {
      showToast(caughtError instanceof ApiError ? caughtError.message : "Unable to update follow state.", "info");
    } finally {
      setFollowBusy(false);
    }
  };

  const transcriptionNode = useMemo(() => {
    if (tweet.status === "error") {
      return (
        <div className="rounded-2xl border border-x-red/35 bg-x-red/10 p-4">
          <p className="text-[13px] font-semibold text-red-100">Transcription Error</p>
          <p className="mt-2 text-[15px] leading-6 text-red-100">{tweet.error_message || "We couldn't transcribe this clip."}</p>
        </div>
      );
    }

    if (tweet.status === "completed") {
      return (
        <div className="rounded-2xl border border-white/10 bg-[#111214] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-semibold text-x-secondary">AI transcript</p>
            <span className="text-[13px] text-x-secondary">Ready</span>
          </div>
          <p className="mt-3 whitespace-pre-line text-[15px] leading-6 text-x-primary">{tweet.transcription_text}</p>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-white/10 bg-[#111214] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-x-secondary">AI transcript</p>
          <span className="rounded-full bg-[#1d9bf0]/10 px-3 py-1 text-[12px] font-semibold text-x-blue">
            {showSimulation ? "Previewing" : "Processing"}
          </span>
        </div>
        <p className="mt-3 text-[15px] leading-6 text-x-primary">
          {showSimulation ? SIMULATED_TRANSCRIPTION : "Whisper is still processing this clip. Open the thread to see live updates."}
        </p>
      </div>
    );
  }, [showSimulation, tweet.error_message, tweet.status, tweet.transcription_text]);

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}${threadPath}`;
    if (navigator.share) {
      navigator.share({ title: `${tweet.user.username} on Voice Atlas`, url: shareUrl }).catch(() => {});
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("Permalink copied!", "success");
    } catch {
      showToast("Could not copy the permalink.", "info");
    }
  };

  return (
    <motion.article
      animate={{ opacity: 1, y: 0 }}
      className="x-card border-t-0 px-4 py-4 transition hover:bg-white/[0.015] phone:px-5"
      initial={{ opacity: 0, y: 14 }}
      transition={{ duration: 0.24 }}
    >
      <div className="flex gap-3">
        {avatarUrl ? (
          <img alt={tweet.user.username} className="h-10 w-10 shrink-0 rounded-full object-cover" src={avatarUrl} />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1d9bf0]/15 text-[15px] font-bold text-x-blue">
            {tweet.user.username.slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <button className="min-w-0 text-left" onClick={() => navigate(threadPath)} type="button">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
                <span className="truncate font-bold text-x-primary">{tweet.user.username}</span>
                {isAdminAuthor ? <Shield className="h-4 w-4 text-x-blue" /> : null}
                <span className="truncate text-x-secondary">@{tweet.user.username.toLowerCase()}</span>
                <span className="text-x-secondary">·</span>
                <span className="text-x-secondary">{formatTimestamp(tweet.created_at)}</span>
              </div>
              <p className="mt-3 text-[15px] leading-6 text-x-primary">{buildLeadCopy(tweet)}</p>
              {tweet.parent_tweet_id ? <p className="mt-2 text-[13px] font-medium text-x-blue">Reply in thread</p> : null}
            </button>

            <div className="flex items-center gap-2">
              {canFollow ? (
                <button
                  className={[
                    "rounded-full px-4 py-2 text-[14px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
                    isFollowingAuthor ? "border border-white/10 text-x-primary hover:bg-x-hover" : "bg-white text-black hover:bg-white/90",
                  ].join(" ")}
                  disabled={followBusy}
                  onClick={() => void toggleFollow()}
                  type="button"
                >
                  {followBusy ? "..." : isFollowingAuthor ? "Following" : "Follow"}
                </button>
              ) : null}

              {!canDelete ? (
                <SafetyMenu
                  onActionComplete={() => onRefreshRequested?.()}
                  targetUserId={tweet.user.id}
                  targetUsername={tweet.user.username}
                  tweetId={tweet.id}
                />
              ) : null}

              {canDelete ? (
                <button
                  aria-label="Delete post"
                  className="x-icon-button h-9 w-9 hover:bg-x-red/10 hover:text-x-red disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={deleting}
                  onClick={() => void deleteTweet()}
                  type="button"
                >
                  <Trash2 className="h-[18px] w-[18px]" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 rounded-[20px] border border-white/10 bg-[#111214] p-4">
            <audio preload="metadata" ref={audioRef} src={audioUrl}>
              <track kind="captions" />
            </audio>

            <div className="flex flex-wrap items-center gap-3">
              <button
                aria-label={isPlaying ? "Pause" : "Play"}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-x-blue text-white transition hover:bg-[#1a8cd8]"
                onClick={() => void togglePlayback()}
                type="button"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-[1px]" />}
              </button>

              <div className="min-w-[168px] flex-1">
                <input
                  aria-label="Seek audio"
                  className="audio-slider"
                  max={duration || 0}
                  min="0"
                  onChange={(event) => scrub(event.target.value)}
                  step="0.01"
                  style={{ "--track-fill": duration ? `${(Math.min(currentTime, duration) / duration) * 100}%` : "0%" }}
                  type="range"
                  value={Math.min(currentTime, duration || 0)}
                />
                <div className="mt-2 flex items-center justify-between text-[13px] text-x-secondary">
                  <span>{formatDuration(currentTime)}</span>
                  <span>{formatDuration(duration)}</span>
                </div>
              </div>

              <button
                aria-label="Cycle playback speed"
                className="rounded-full border border-white/10 px-3 py-2 text-[13px] font-semibold text-x-primary transition hover:bg-x-hover"
                onClick={cycleSpeed}
                type="button"
              >
                {PLAYBACK_SPEEDS[speedIndex]}x
              </button>

              <button aria-label="Reset playback" className="x-icon-button h-10 w-10" onClick={resetPlayer} type="button">
                <RotateCcw className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>

          <div className="mt-4">{transcriptionNode}</div>

          <div className="mt-4 flex items-center justify-between text-x-secondary">
            <button
              className="group flex min-w-[68px] items-center gap-2 rounded-full px-2 py-2 text-[13px] transition hover:text-x-blue"
              onClick={() => navigate(threadPath)}
              type="button"
            >
              <span className="x-icon-button h-8 w-8 group-hover:bg-[#1d9bf0]/10 group-hover:text-x-blue">
                <MessageCircle className="h-[18px] w-[18px]" />
              </span>
              <span>{tweet.reply_count || 0}</span>
            </button>

            <button
              className="group flex min-w-[68px] items-center gap-2 rounded-full px-2 py-2 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-60"
              disabled={repostBusy}
              onClick={() => void toggleRepost()}
              type="button"
            >
              <span
                className={[
                  "x-icon-button relative h-8 w-8",
                  engagement.isReposted ? "bg-x-green/10 text-x-green" : "group-hover:bg-x-green/10 group-hover:text-x-green",
                ].join(" ")}
              >
                <Repeat2 className="h-[18px] w-[18px]" />
              </span>
              <span className={engagement.isReposted ? "text-x-green" : ""}>{engagement.repostCount}</span>
            </button>

            <button
              className="group flex min-w-[68px] items-center gap-2 rounded-full px-2 py-2 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-60"
              disabled={likeBusy}
              onClick={() => void toggleLike()}
              type="button"
            >
              <span
                className={[
                  "x-icon-button relative h-8 w-8",
                  engagement.isLiked ? "bg-x-pink/10 text-x-pink" : "group-hover:bg-x-pink/10 group-hover:text-x-pink",
                ].join(" ")}
              >
                <HeartBurst active={showBurst} />
                <Heart className="h-[18px] w-[18px]" fill={engagement.isLiked ? "currentColor" : "none"} />
              </span>
              <span className={engagement.isLiked ? "text-x-pink" : ""}>{engagement.likeCount}</span>
            </button>

            <button
              className="group flex min-w-[68px] items-center gap-2 rounded-full px-2 py-2 text-[13px] transition hover:text-x-blue"
              onClick={() => void handleShare()}
              type="button"
            >
              <span className="x-icon-button h-8 w-8 group-hover:bg-[#1d9bf0]/10 group-hover:text-x-blue">
                <Share className="h-[18px] w-[18px]" />
              </span>
            </button>
          </div>

          {deleteError ? <p className="mt-3 text-[14px] text-red-200">{deleteError}</p> : null}
        </div>
      </div>
    </motion.article>
  );
}
