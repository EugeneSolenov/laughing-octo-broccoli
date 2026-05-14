import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Heart, MessageCircle, RotateCcw, Shield, ThumbsDown, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, apiFetch, getMediaUrl } from "../api/client";
import { useToast } from "../context/ToastContext.jsx";
import { buildAvatarTone, getAvatarLetter, isPlaceholderAvatarUrl } from "../utils/avatar.js";
import { extractHashtags } from "../utils/hashtags.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import SafetyMenu from "./SafetyMenu.jsx";

const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2];
const AUDIO_PLAYBACK_EVENT = "voice-atlas:audio-play";
const WAVEFORM_CACHE = new Map();

function normalizeDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function clampTime(value, max) {
  const numericValue = Number(value);
  const numericMax = normalizeDuration(max);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }
  return numericMax ? Math.min(numericValue, numericMax) : numericValue;
}

function readMediaDuration(audio) {
  if (!audio) {
    return 0;
  }

  const directDuration = normalizeDuration(audio.duration);
  if (directDuration) {
    return directDuration;
  }

  if (audio.seekable?.length) {
    try {
      return normalizeDuration(audio.seekable.end(audio.seekable.length - 1));
    } catch {
      return 0;
    }
  }

  return 0;
}

function formatDuration(seconds, { elapsed = false, total = false } = {}) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return "0:00";
  }

  const roundedSeconds = total ? Math.ceil(duration) : elapsed ? Math.floor(duration + 0.35) : Math.floor(duration);
  return `${Math.floor(roundedSeconds / 60)}:${String(roundedSeconds % 60).padStart(2, "0")}`;
}

function formatTimestamp(value) {
  const diff = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (diff < 1) {
    return "сейчас";
  }
  if (diff < 60) {
    return `${diff}м`;
  }
  if (diff < 1440) {
    return `${Math.floor(diff / 60)}ч`;
  }
  return new Intl.DateTimeFormat("ru-RU", { month: "short", day: "numeric" }).format(new Date(value));
}

function buildLeadCopy(tweet) {
  if (tweet.caption?.trim()) {
    return tweet.caption.trim();
  }

  return null;
}

function buildWaveform(seed, count = 128) {
  let value = Number(seed) || 1;
  if (value <= 0) {
    value = Math.abs(value) + 1;
  }

  return Array.from({ length: count }, () => {
    value = (value * 48271) % 2147483647;
    return 4 + (value % 34);
  });
}

async function buildWaveformFromAudio(audioUrl, { count = 128, signal } = {}) {
  if (!audioUrl || typeof window === "undefined") {
    return null;
  }

  const cached = WAVEFORM_CACHE.get(audioUrl);
  if (cached) {
    return cached;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  const response = await fetch(audioUrl, { signal });
  if (!response.ok) {
    return null;
  }

  const buffer = await response.arrayBuffer();
  const context = new AudioContextCtor();

  try {
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const channel = decoded.getChannelData(0);
    const samplesPerBar = Math.max(1, Math.floor(channel.length / count));
    const peaks = [];

    for (let barIndex = 0; barIndex < count; barIndex += 1) {
      const start = barIndex * samplesPerBar;
      const end = Math.min(channel.length, start + samplesPerBar);
      let peak = 0;
      let sum = 0;
      let sampleCount = 0;

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        const absolute = Math.abs(channel[sampleIndex]);
        peak = Math.max(peak, absolute);
        sum += absolute * absolute;
        sampleCount += 1;
      }

      const rms = sampleCount ? Math.sqrt(sum / sampleCount) : 0;
      const amplitude = Math.min(1, rms * 3.2 + peak * 0.35);
      peaks.push(2 + Math.round(amplitude * 54));
    }

    WAVEFORM_CACHE.set(audioUrl, peaks);
    return peaks;
  } finally {
    await context.close().catch(() => {});
  }
}

function HeartBurst({ active }) {
  return (
    <AnimatePresence>
      {active ? (
        <motion.span
          animate={{ opacity: 1, scale: 1 }}
          className="pointer-events-none absolute inset-0"
          exit={{ opacity: 0, scale: 1.18 }}
          initial={{ opacity: 0, scale: 0.4 }}
        >
          {[0, 1, 2, 3, 4, 5].map((index) => {
            const angle = (Math.PI * 2 * index) / 6;
            return (
              <motion.span
                animate={{
                  opacity: [1, 0],
                  x: [0, Math.cos(angle) * 14],
                  y: [0, Math.sin(angle) * 14],
                  scale: [0.6, 1.08],
                }}
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
                key={index}
                style={{ background: "var(--md-sys-color-tertiary)", marginLeft: -3, marginTop: -3 }}
                transition={{ duration: 0.38, ease: "easeOut" }}
              />
            );
          })}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

function TranscriptBlock({ threadPath, tweet }) {
  if (tweet.status === "error") {
    return (
      <div className="transcript-block transcript-block--issue">
        <div className="transcript-header transcript-header--issue">
          <span className="transcript-issue__label">
            <AlertTriangle aria-hidden="true" size={14} strokeWidth={1.9} />
            Проблема с транскрипцией
          </span>
          <Link className="transcript-issue__link" to={threadPath}>
            Подробнее
          </Link>
        </div>
        <div className="transcript-content transcript-content--issue">
          {tweet.error_message || "Не удалось расшифровать этот клип."}
        </div>
      </div>
    );
  }

  if (tweet.status === "completed") {
    return (
      <div className="transcript-block va-transcript">
        <div className="transcript-header va-transcript-header">
          <span className="m3-section-label">Транскрипция</span>
          <span className="va-pill va-pill-green">Готово</span>
        </div>
        <div className="transcript-content">{tweet.transcription_text}</div>
      </div>
    );
  }

  return (
    <div className="transcript-block va-transcript">
      <div className="transcript-header va-transcript-header">
        <span className="m3-section-label">Транскрипция</span>
        <span className="va-pill va-pill-amber">{"Обработка\u2026"}</span>
      </div>
      <div style={{ padding: 12, display: "grid", gap: 8 }}>
        <div className="m3-skeleton" style={{ height: 12 }} />
        <div className="m3-skeleton" style={{ height: 12, width: "78%" }} />
        <div className="m3-skeleton" style={{ height: 12, width: "62%" }} />
      </div>
    </div>
  );
}

export default function PostCard({ currentUser, onDeleted, onRefreshRequested, tweet }) {
  const showToast = useToast();
  const audioRef = useRef(null);
  const playerIdRef = useRef(`player-${tweet.id}-${Math.random().toString(36).slice(2)}`);
  const isSeekingRef = useRef(false);
  const seekPreviewRef = useRef(null);
  const wasPlayingBeforeSeekRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [showBurst, setShowBurst] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [dislikeBusy, setDislikeBusy] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [seekPreview, setSeekPreview] = useState(null);
  const [waveform, setWaveform] = useState(() => buildWaveform(tweet.id));
  const durationHint = normalizeDuration(tweet.duration_seconds);
  const [engagement, setEngagement] = useState({
    isLiked: Boolean(tweet.liked_by_viewer),
    isDisliked: Boolean(tweet.disliked_by_viewer ?? tweet.reposted_by_viewer),
    likeCount: tweet.likes_count || 0,
    dislikeCount: tweet.dislikes_count ?? tweet.reposts_count ?? 0,
  });
  const [isFollowing, setIsFollowing] = useState(Boolean(tweet.user.is_following));
  const [showSimulation, setShowSimulation] = useState(Boolean(tweet.client_simulated && tweet.status === "processing"));

  const audioUrl = getMediaUrl(tweet.audio_url);
  const hasAudio = Boolean(audioUrl);
  const rawAvatarUrl = tweet.user.avatar_url ? getMediaUrl(tweet.user.avatar_url) : "";
  const avatarUrl = isPlaceholderAvatarUrl(rawAvatarUrl) ? "" : rawAvatarUrl;
  const isAdmin = String(tweet.user.role || "").toLowerCase() === "admin";
  const canDelete = Boolean(currentUser) && (String(currentUser.role || "").toLowerCase() === "admin" || currentUser.id === tweet.user.id);
  const canFollow = Boolean(currentUser) && currentUser.id !== tweet.user.id;
  const authorPath = `/profile/${tweet.user.id}`;
  const threadPath = `/post/${tweet.id}`;
  const isReply = Boolean(tweet.parent_tweet_id);
  const durationForControls = Math.max(duration, durationHint, 0);
  const effectiveCurrentTime = clampTime(seekPreview ?? currentTime, durationForControls);
  const progressRatio = durationForControls ? Math.min(effectiveCurrentTime, durationForControls) / durationForControls : 0;
  const fill = `${progressRatio * 100}%`;
  const leadCopy = buildLeadCopy(tweet);
  const tags = useMemo(() => extractHashtags(tweet.caption || "", { limit: 3 }), [tweet.caption]);
  const avatarLetter = useMemo(() => getAvatarLetter(tweet.user.username), [tweet.user.username]);
  const avatarTone = useMemo(() => buildAvatarTone(tweet.user.username), [tweet.user.username]);
  const playedBars = progressRatio > 0 ? Math.max(1, Math.ceil(progressRatio * waveform.length)) : 0;
  const isLive = showSimulation || tweet.status === "processing";
  const authorHandle = `@${tweet.user.username.toLowerCase()}`;
  const timeReadout = `${formatDuration(effectiveCurrentTime, { elapsed: true })} / ${formatDuration(durationForControls, { total: true })}`;
  const shouldRenderTranscript = hasAudio || Boolean(tweet.error_message) || Boolean(tweet.transcription_text?.trim());

  useEffect(() => {
    setEngagement({
      isLiked: Boolean(tweet.liked_by_viewer),
      isDisliked: Boolean(tweet.disliked_by_viewer ?? tweet.reposted_by_viewer),
      likeCount: tweet.likes_count || 0,
      dislikeCount: tweet.dislikes_count ?? tweet.reposts_count ?? 0,
    });
  }, [tweet.id, tweet.disliked_by_viewer, tweet.likes_count, tweet.liked_by_viewer, tweet.reposted_by_viewer, tweet.reposts_count, tweet.dislikes_count]);

  useEffect(() => {
    setIsFollowing(Boolean(tweet.user.is_following));
  }, [tweet.user.id, tweet.user.is_following]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUrl]);

  useEffect(() => {
    isSeekingRef.current = false;
    seekPreviewRef.current = null;
    wasPlayingBeforeSeekRef.current = false;
    setSeekPreview(null);
    setCurrentTime(0);
    setDuration(durationHint);
    setIsPlaying(false);
    setWaveform(buildWaveform(tweet.id));
  }, [tweet.id, durationHint]);

  useEffect(() => {
    if (!audioUrl) {
      return undefined;
    }

    const controller = new AbortController();
    void buildWaveformFromAudio(audioUrl, { signal: controller.signal })
      .then((peaks) => {
        if (peaks?.length) {
          setWaveform(peaks);
        }
      })
      .catch(() => {
        // The deterministic fallback keeps the player usable if decoding fails.
      });

    return () => controller.abort();
  }, [audioUrl, tweet.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    let frameId = 0;
    const stopFrame = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };

    const syncFrame = () => {
      if (!isSeekingRef.current) {
        setCurrentTime(audio.currentTime);
      }
      if (!audio.paused && !audio.ended) {
        frameId = window.requestAnimationFrame(syncFrame);
      }
    };

    const syncDuration = () => {
      const nextDuration = readMediaDuration(audio);
      if (nextDuration) {
        setDuration(nextDuration);
      }
    };
    const onTime = () => {
      if (!isSeekingRef.current) {
        setCurrentTime(audio.currentTime);
      }
    };
    const onPause = () => {
      setIsPlaying(false);
      stopFrame();
    };
    const onPlay = () => {
      setIsPlaying(true);
      window.dispatchEvent(new CustomEvent(AUDIO_PLAYBACK_EVENT, { detail: { id: playerIdRef.current } }));
      stopFrame();
      frameId = window.requestAnimationFrame(syncFrame);
    };
    const onEnd = () => {
      isSeekingRef.current = false;
      seekPreviewRef.current = null;
      wasPlayingBeforeSeekRef.current = false;
      setSeekPreview(null);
      setCurrentTime(0);
      setIsPlaying(false);
      stopFrame();
    };

    syncDuration();
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("loadeddata", syncDuration);
    audio.addEventListener("durationchange", syncDuration);
    audio.addEventListener("canplay", syncDuration);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("ended", onEnd);

    const pauseWhenAnotherCardStarts = (event) => {
      if (event.detail?.id !== playerIdRef.current && !audio.paused) {
        audio.pause();
      }
    };

    window.addEventListener(AUDIO_PLAYBACK_EVENT, pauseWhenAnotherCardStarts);

    return () => {
      stopFrame();
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("loadeddata", syncDuration);
      audio.removeEventListener("durationchange", syncDuration);
      audio.removeEventListener("canplay", syncDuration);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("ended", onEnd);
      window.removeEventListener(AUDIO_PLAYBACK_EVENT, pauseWhenAnotherCardStarts);
    };
  }, [audioUrl, durationHint]);

  useEffect(() => {
    if (!(tweet.client_simulated && tweet.status === "processing")) {
      setShowSimulation(false);
      return undefined;
    }

    setShowSimulation(true);
    const timeout = window.setTimeout(() => setShowSimulation(false), 3200);
    return () => window.clearTimeout(timeout);
  }, [tweet.client_simulated, tweet.status]);

  const syncEngagement = (nextTweet) => {
    setEngagement({
      isLiked: Boolean(nextTweet.liked_by_viewer),
      isDisliked: Boolean(nextTweet.disliked_by_viewer ?? nextTweet.reposted_by_viewer),
      likeCount: nextTweet.likes_count || 0,
      dislikeCount: nextTweet.dislikes_count ?? nextTweet.reposts_count ?? 0,
    });
    setIsFollowing(Boolean(nextTweet.user?.is_following));
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !hasAudio) {
      return;
    }

    if (audio.paused) {
      window.dispatchEvent(new CustomEvent(AUDIO_PLAYBACK_EVENT, { detail: { id: playerIdRef.current } }));
      audio.playbackRate = PLAYBACK_SPEEDS[speedIndex];
      await audio.play().catch(() => {
        setIsPlaying(false);
        showToast("Не удалось воспроизвести аудио.", "info");
      });
    } else {
      audio.pause();
    }
  };

  const cycleSpeed = () => {
    const audio = audioRef.current;
    if (!audio || !hasAudio) {
      return;
    }

    const nextIndex = (speedIndex + 1) % PLAYBACK_SPEEDS.length;
    audio.playbackRate = PLAYBACK_SPEEDS[nextIndex];
    setSpeedIndex(nextIndex);
  };

  const getSeekDuration = () => Math.max(duration, durationHint, readMediaDuration(audioRef.current), 0);

  const getPointerSeekTime = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) : 0;
    return ratio * getSeekDuration();
  };

  const prepareSeek = (value) => {
    const audio = audioRef.current;
    if (!audio || !hasAudio) {
      return;
    }

    if (!isSeekingRef.current) {
      isSeekingRef.current = true;
      wasPlayingBeforeSeekRef.current = !audio.paused && !audio.ended;
      audio.pause();
    }

    updateSeekPreview(value ?? audio.currentTime);
  };

  const beginSeek = (event) => {
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is a progressive enhancement for smoother drags.
    }
    prepareSeek(getPointerSeekTime(event));
  };

  const updateSeekPreview = (value) => {
    const boundedValue = clampTime(value, getSeekDuration());
    seekPreviewRef.current = boundedValue;
    setSeekPreview(boundedValue);
  };

  const commitSeek = async (value) => {
    const audio = audioRef.current;
    if (!audio || !hasAudio) {
      return;
    }

    const maxDuration = getSeekDuration();
    const nextTime = clampTime(value ?? seekPreviewRef.current ?? audio.currentTime, maxDuration);
    try {
      audio.currentTime = nextTime;
    } catch {
      // Some browsers can reject seeks before metadata is ready.
    }
    setCurrentTime(nextTime);
    isSeekingRef.current = false;
    seekPreviewRef.current = null;
    setSeekPreview(null);

    if (wasPlayingBeforeSeekRef.current && nextTime < maxDuration) {
      try {
        await audio.play();
      } catch {
        // Ignore playback resume failures.
      }
    }
    wasPlayingBeforeSeekRef.current = false;
  };

  const finishSeek = (event) => {
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // The browser may already have released capture on cancel/blur.
    }
    void commitSeek(event.currentTarget.value ?? getPointerSeekTime(event));
  };

  const handleSeekInput = (event) => {
    if (!isSeekingRef.current) {
      prepareSeek(event.currentTarget.value);
      return;
    }

    updateSeekPreview(event.currentTarget.value);
  };

  const handleSeekChange = (event) => {
    if (!isSeekingRef.current) {
      void commitSeek(event.currentTarget.value);
    }
  };

  const handleSeekPointerMove = (event) => {
    if (isSeekingRef.current) {
      updateSeekPreview(getPointerSeekTime(event));
    }
  };

  const handleSeekKeyDown = (event) => {
    const maxDuration = getSeekDuration();
    const baseTime = seekPreviewRef.current ?? currentTime;
    let nextTime = null;

    if (event.key === "Home") {
      nextTime = 0;
    } else if (event.key === "End") {
      nextTime = maxDuration;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextTime = baseTime - (event.shiftKey ? 5 : 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextTime = baseTime + (event.shiftKey ? 5 : 1);
    } else if (event.key === "PageDown") {
      nextTime = baseTime - 10;
    } else if (event.key === "PageUp") {
      nextTime = baseTime + 10;
    }

    if (nextTime !== null) {
      event.preventDefault();
      const boundedTime = clampTime(nextTime, maxDuration);
      prepareSeek(boundedTime);
      void commitSeek(boundedTime);
    }
  };

  const reset = () => {
    const audio = audioRef.current;
    if (!audio || !hasAudio) {
      return;
    }

    audio.currentTime = 0;
    audio.pause();
    isSeekingRef.current = false;
    seekPreviewRef.current = null;
    wasPlayingBeforeSeekRef.current = false;
    setSeekPreview(null);
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const toggleLike = async () => {
    if (!currentUser) {
      showToast("Войдите, чтобы ставить лайки.", "info");
      return;
    }

    const nextState = !engagement.isLiked;
    const previousEngagement = engagement;
    setLikeBusy(true);
    setEngagement((current) => ({
      ...current,
      isLiked: nextState,
      isDisliked: nextState ? false : current.isDisliked,
      likeCount: Math.max(0, current.likeCount + (nextState ? 1 : -1)),
      dislikeCount: nextState && current.isDisliked ? Math.max(0, current.dislikeCount - 1) : current.dislikeCount,
    }));

    if (nextState) {
      setShowBurst(true);
      window.setTimeout(() => setShowBurst(false), 420);
    }

    try {
      const nextTweet = await apiFetch(`/tweets/${tweet.id}/like`, { method: nextState ? "POST" : "DELETE" });
      syncEngagement(nextTweet);
    } catch (error) {
      setEngagement(previousEngagement);
      showToast(error instanceof ApiError ? error.message : "Не удалось обновить лайк.", "info");
    } finally {
      setLikeBusy(false);
    }
  };

  const toggleDislike = async () => {
    if (!currentUser) {
      showToast("Войдите, чтобы поставить дизлайк.", "info");
      return;
    }

    const nextState = !engagement.isDisliked;
    const previousEngagement = engagement;
    setDislikeBusy(true);
    setEngagement((current) => ({
      ...current,
      isDisliked: nextState,
      isLiked: nextState ? false : current.isLiked,
      likeCount: nextState && current.isLiked ? Math.max(0, current.likeCount - 1) : current.likeCount,
      dislikeCount: Math.max(0, current.dislikeCount + (nextState ? 1 : -1)),
    }));

    try {
      const nextTweet = await apiFetch(`/tweets/${tweet.id}/dislike`, { method: nextState ? "POST" : "DELETE" });
      syncEngagement(nextTweet);
    } catch (error) {
      setEngagement(previousEngagement);
      showToast(error instanceof ApiError ? error.message : "Не удалось обновить дизлайк.", "info");
    } finally {
      setDislikeBusy(false);
    }
  };

  const toggleFollow = async () => {
    if (!canFollow) {
      return;
    }

    const nextState = !isFollowing;

    try {
      setFollowBusy(true);
      const result = await apiFetch(`/users/${tweet.user.id}/follow`, { method: nextState ? "POST" : "DELETE" });
      setIsFollowing(Boolean(result.is_following));
      onRefreshRequested?.();
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Не удалось обновить подписку.", "info");
    } finally {
      setFollowBusy(false);
    }
  };

  const deleteTweet = async () => {
    try {
      setDeleting(true);
      setDeleteError("");
      await apiFetch(`/tweets/${tweet.id}`, { method: "DELETE" });
      onDeleted?.(tweet.id);
      setIsDeleteConfirmOpen(false);
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error.message : "Не удалось удалить запись.");
    } finally {
      setDeleting(false);
    }
  };

  const player = hasAudio ? (
    <div className={["audio-player", tweet.status === "error" ? "audio-player--embedded" : ""].join(" ")}>
      <audio preload="metadata" ref={audioRef} src={audioUrl}>
        <track kind="captions" />
      </audio>

      <button
        aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
        className={["audio-player__play-button", "m3-interactive", isPlaying ? "is-playing" : ""].join(" ")}
        onClick={() => void togglePlay()}
        type="button"
      >
        <span aria-hidden="true" className="audio-player__play-button-frame">
          <span className="audio-player__play-glyph" />
        </span>
      </button>

      <div className="audio-player__body">
        <div aria-hidden="true" className="audio-waveform" style={{ "--audio-waveform-bars": waveform.length }}>
          {waveform.map((height, index) => (
            <span className={["audio-waveform-bar", index < playedBars ? "played" : ""].join(" ")} key={`${index}-${height}`} style={{ height }} />
          ))}
        </div>
        <div className="audio-player__timeline">
          <input
            aria-label="Перемотка аудио"
            className="audio-progress"
            disabled={!durationForControls}
            max={durationForControls || 0.01}
            min="0"
            onBlur={(event) => {
              if (isSeekingRef.current) {
                void commitSeek(event.currentTarget.value);
              }
            }}
            onChange={handleSeekChange}
            onInput={handleSeekInput}
            onKeyDown={handleSeekKeyDown}
            onPointerCancel={finishSeek}
            onPointerDown={beginSeek}
            onPointerMove={handleSeekPointerMove}
            onPointerUp={finishSeek}
            step="0.01"
            style={{ "--fill": fill }}
            type="range"
            value={Math.min(effectiveCurrentTime, durationForControls || 0)}
          />
          <div className="audio-player__timeline-footer">
            <span className="m3-body-small audio-player__time-readout">{timeReadout}</span>
          </div>
        </div>
      </div>

      <div className="audio-player__inline-controls">
        <button className="m3-button m3-button-outlined m3-interactive audio-player__speed-button" onClick={cycleSpeed} type="button">
          {PLAYBACK_SPEEDS[speedIndex]}x
        </button>
        <button aria-label="Сбросить аудио" className="m3-icon-button m3-icon-button--outlined m3-interactive audio-player__reset-button" onClick={reset} type="button">
          <RotateCcw size={16} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
    <article className={["m3-card", "audio-post-card", !leadCopy ? "is-without-caption" : ""].join(" ")}>
      <div className="audio-post-meta">
        <Link to={authorPath}>
          {avatarUrl && !avatarFailed ? (
            <img
              alt={tweet.user.username}
              loading="lazy"
              onError={() => setAvatarFailed(true)}
              src={avatarUrl}
              className="post-card__avatar-image"
            />
          ) : (
            <div className="m3-avatar post-card__avatar-fallback" style={avatarTone}>
              {avatarLetter}
            </div>
          )}
        </Link>

        <div className="audio-post-body">
          <div className="post-card__header">
            <div className="post-card__identity">
              <div className="post-card__name-row">
                <Link className="m3-title-medium post-card__author-name" title={tweet.user.username} to={authorPath} translate="no">
                  {tweet.user.username}
                </Link>
                {isAdmin ? <Shield size={14} style={{ color: "var(--md-sys-color-primary)" }} /> : null}
                {isLive ? (
                  <span className="m3-live-pill">
                    <span className="m3-live-dot" />
                    Обработка
                  </span>
                ) : null}
              </div>
              <p className="m3-body-small post-card__author-handle" title={authorHandle} translate="no">
                {authorHandle} {"\u00b7"} {formatTimestamp(tweet.created_at)}
              </p>
            </div>

            <div className="post-card__author-actions">
              {canFollow ? (
                <button
                  className={["m3-button", "m3-button-outlined", "m3-interactive", "post-card__follow-button", isFollowing ? "is-following" : ""].join(" ")}
                  disabled={followBusy}
                  onClick={() => void toggleFollow()}
                  type="button"
                >
                  {followBusy ? "Обновление\u2026" : isFollowing ? "Вы подписаны" : "Подписаться"}
                </button>
              ) : null}
              {!canDelete ? <SafetyMenu onActionComplete={() => onRefreshRequested?.()} targetUserId={tweet.user.id} targetUsername={tweet.user.username} tweetId={tweet.id} /> : null}
              {canDelete ? (
                <button aria-label="Удалить запись" className="m3-icon-button m3-icon-button--outlined m3-interactive m3-state-tertiary" disabled={deleting} onClick={() => setIsDeleteConfirmOpen(true)} type="button">
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          </div>

          {leadCopy ? (
            <Link className="m3-interactive post-card__lead-link" title={leadCopy} to={threadPath}>
              <p className="post-card__lead">{leadCopy}</p>
            </Link>
          ) : null}

          {player && tweet.status === "error" ? (
            <div className="post-card__player-stack">
              {player}
              <TranscriptBlock threadPath={threadPath} tweet={tweet} />
            </div>
          ) : (
            <>
              {player}
              {shouldRenderTranscript ? <TranscriptBlock threadPath={threadPath} tweet={tweet} /> : null}
            </>
          )}

          <div className="post-actions" style={tags.length ? undefined : { justifyContent: "flex-end" }}>
            {tags.length ? (
              <div className="post-tags">
                {tags.map((tag) => (
                  <Link className="m3-chip m3-interactive post-tag-pill" key={tag} to={`/?q=${encodeURIComponent(tag.replace(/^#/, ""))}`}>
                    {tag}
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="post-interactions">
              {!isReply ? (
                <Link
                  aria-label={`Открыть обсуждение, ответов: ${tweet.reply_count || 0}`}
                  className="va-action-btn m3-interactive"
                  to={threadPath}
                >
                  <span className="va-action-icon">
                    <MessageCircle size={20} strokeWidth={1.5} />
                  </span>
                  <span>{tweet.reply_count || 0}</span>
                </Link>
              ) : null}

              <button
                aria-label={engagement.isDisliked ? "Убрать дизлайк" : "Дизлайк"}
                aria-pressed={engagement.isDisliked}
                className={["va-action-btn", "m3-interactive", engagement.isDisliked ? "disliked" : ""].join(" ")}
                disabled={likeBusy || dislikeBusy}
                onClick={() => void toggleDislike()}
                type="button"
              >
                <span className="va-action-icon">
                  <ThumbsDown fill="none" size={20} strokeWidth={engagement.isDisliked ? 2.2 : 1.5} />
                </span>
                <span>{engagement.dislikeCount}</span>
              </button>

              <button
                aria-label={engagement.isLiked ? "Убрать лайк" : "Лайк"}
                className={["va-action-btn", "m3-interactive", "m3-state-tertiary", engagement.isLiked ? "liked" : ""].join(" ")}
                disabled={likeBusy || dislikeBusy}
                onClick={() => void toggleLike()}
                type="button"
              >
                <span className="va-action-icon" style={{ position: "relative" }}>
                  <HeartBurst active={showBurst} />
                  <Heart fill={engagement.isLiked ? "currentColor" : "none"} size={20} strokeWidth={1.5} />
                </span>
                <span>{engagement.likeCount}</span>
              </button>

            </div>
          </div>

          {deleteError ? <p className="m3-error">{deleteError}</p> : null}
        </div>
      </div>
    </article>
    <ConfirmDialog
      busy={deleting}
      confirmLabel="Удалить"
      description="Запись, аудио и обсуждение будут удалены без возможности восстановить их из интерфейса."
      onCancel={() => setIsDeleteConfirmOpen(false)}
      onConfirm={() => void deleteTweet()}
      open={isDeleteConfirmOpen}
      title="Удалить эту запись?"
    />
    </>
  );
}
