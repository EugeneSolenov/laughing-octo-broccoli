import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, Mic, Pause, Play, RotateCcw, Scissors, Send, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RecordPlugin from "wavesurfer.js/dist/plugins/record.esm.js";

import { ApiError, apiFetch } from "../api/client";

const MIME_PRIORITY = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"];

const MIME_EXTENSION_MAP = {
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return MIME_PRIORITY.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function formatClock(milliseconds) {
  const totalSeconds = Math.floor((milliseconds || 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function clampTrimValue(value, max) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return 0;
  }
  return Math.max(0, Math.min(nextValue, max));
}

export default function PostComposer({
  onClose,
  onCreated,
  replyToTweetId = null,
  user,
  variant = "inline",
}) {
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewLabel, setPreviewLabel] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [selectedMimeType, setSelectedMimeType] = useState("");
  const [trimEndSeconds, setTrimEndSeconds] = useState("");
  const [trimStartSeconds, setTrimStartSeconds] = useState("");

  const fileInputRef = useRef(null);
  const recordPluginRef = useRef(null);
  const previewUrlRef = useRef("");
  const waveSurferRef = useRef(null);
  const waveformContainerRef = useRef(null);

  const isModal = variant === "modal";
  const trimStart = clampTrimValue(trimStartSeconds, previewDuration || 0);
  const trimEnd = trimEndSeconds === "" ? null : clampTrimValue(trimEndSeconds, previewDuration || 0);
  const effectiveDuration = useMemo(() => {
    if (!previewDuration) {
      return 0;
    }
    const boundedEnd = trimEnd ?? previewDuration;
    return Math.max(0, boundedEnd - trimStart);
  }, [previewDuration, trimEnd, trimStart]);

  const resetPreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }

    previewUrlRef.current = "";
    setPreviewUrl("");
    setPreviewLabel("");
    setRecordingBlob(null);
    setRecordingDuration(0);
    setPreviewCurrentTime(0);
    setPreviewDuration(0);
    setTrimStartSeconds("");
    setTrimEndSeconds("");
    setIsPreviewPlaying(false);
    setError("");
    waveSurferRef.current?.empty();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!waveformContainerRef.current) {
      return undefined;
    }

    const waveSurfer = WaveSurfer.create({
      container: waveformContainerRef.current,
      waveColor: "#536471",
      progressColor: "#1D9BF0",
      cursorColor: "#E7E9EA",
      cursorWidth: 2,
      height: isModal ? 140 : 112,
      normalize: true,
      barWidth: 3,
      barGap: 2,
      barRadius: 999,
      dragToSeek: true,
    });

    const recordPlugin = waveSurfer.registerPlugin(
      RecordPlugin.create({
        mimeType: pickMimeType() || undefined,
        renderRecordedAudio: true,
        continuousWaveform: true,
        continuousWaveformDuration: 8,
        scrollingWaveform: true,
        scrollingWaveformWindow: 6,
      }),
    );

    waveSurfer.on("play", () => setIsPreviewPlaying(true));
    waveSurfer.on("pause", () => setIsPreviewPlaying(false));
    waveSurfer.on("finish", () => {
      setIsPreviewPlaying(false);
      setPreviewCurrentTime(0);
    });
    waveSurfer.on("timeupdate", (currentTime) => {
      setPreviewCurrentTime(currentTime);
    });
    waveSurfer.on("ready", () => {
      setPreviewDuration(waveSurfer.getDuration() || 0);
    });

    recordPlugin.on("record-progress", (duration) => {
      setRecordingDuration(duration);
    });

    recordPlugin.on("record-end", async (blob) => {
      const nextPreviewUrl = URL.createObjectURL(blob);
      previewUrlRef.current = nextPreviewUrl;
      setRecordingBlob(blob);
      setPreviewUrl(nextPreviewUrl);
      setPreviewLabel("Recorded clip");
      setSelectedMimeType(blob.type || pickMimeType() || "audio/ogg");
      setIsRecording(false);
      await waveSurfer.loadBlob(blob);
    });

    waveSurferRef.current = waveSurfer;
    recordPluginRef.current = recordPlugin;

    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }

      try {
        recordPlugin.stopRecording();
        recordPlugin.stopMic();
      } catch {
        // Ignore cleanup failures during hot reloads or interrupted recordings.
      }

      waveSurfer.destroy();
    };
  }, [isModal]);

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Your browser does not support in-browser audio recording.");
      }

      resetPreview();
      setSelectedMimeType(pickMimeType() || "audio/ogg");
      setError("");

      await recordPluginRef.current?.startRecording({
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000,
      });

      setIsRecording(true);
    } catch (caughtError) {
      setError(caughtError?.message || "Unable to start recording.");
      setIsRecording(false);
    }
  };

  const loadSelectedFile = async (file) => {
    if (!file) {
      return;
    }

    try {
      resetPreview();
      const nextPreviewUrl = URL.createObjectURL(file);
      previewUrlRef.current = nextPreviewUrl;
      setRecordingBlob(file);
      setPreviewUrl(nextPreviewUrl);
      setPreviewLabel(file.name);
      setSelectedMimeType(file.type || "audio/webm");
      setError("");
      await waveSurferRef.current?.loadBlob(file);
    } catch (caughtError) {
      setError(caughtError?.message || "Unable to load the selected file.");
    }
  };

  const stopRecording = () => {
    recordPluginRef.current?.stopRecording();
    setIsRecording(false);
  };

  const togglePreviewPlayback = async () => {
    if (!waveSurferRef.current || !previewUrl) {
      return;
    }

    await waveSurferRef.current.playPause();
  };

  const uploadRecording = async () => {
    if (!recordingBlob) {
      return;
    }

    if (trimEnd !== null && trimEnd <= trimStart) {
      setError("Trim end must be greater than trim start.");
      return;
    }

    try {
      setIsUploading(true);
      setError("");

      const effectiveMimeType = recordingBlob.type || selectedMimeType || "audio/webm";
      const extension =
        MIME_EXTENSION_MAP[effectiveMimeType] ||
        (effectiveMimeType.includes("wav") ? "wav" : effectiveMimeType.includes("ogg") ? "ogg" : "webm");
      const fileName = recordingBlob instanceof File && recordingBlob.name ? recordingBlob.name : `voice-atlas.${extension}`;
      const formData = new FormData();

      formData.append(
        "audio",
        recordingBlob instanceof File
          ? recordingBlob
          : new File([recordingBlob], fileName, {
              type: effectiveMimeType,
            }),
      );
      if (caption.trim()) {
        formData.append("caption", caption.trim());
      }
      if (replyToTweetId) {
        formData.append("parent_tweet_id", String(replyToTweetId));
      }
      if (trimStart > 0) {
        formData.append("trim_start_seconds", String(trimStart));
      }
      if (trimEnd !== null && trimEnd < previewDuration) {
        formData.append("trim_end_seconds", String(trimEnd));
      }

      const endpoint = replyToTweetId ? `/tweets/${replyToTweetId}/reply` : "/tweets/create";
      const createdTweet = await apiFetch(endpoint, {
        method: "POST",
        body: formData,
      });

      onCreated?.({
        ...createdTweet,
        client_simulated: true,
        client_created_at: Date.now(),
      });
      setCaption("");
      resetPreview();
      onClose?.();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <section className={["x-card relative overflow-hidden", isModal ? "rounded-[24px] p-5 phone:p-6" : "rounded-none"].join(" ")}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

      <div className="flex gap-3">
        <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1d9bf0]/15 text-sm font-bold text-x-blue">
          {user?.username?.slice(0, 2).toUpperCase() || "VA"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-bold text-x-primary">{replyToTweetId ? "Reply with audio" : isModal ? "Create a voice post" : "Capture a new clip"}</p>
              <p className="mt-1 text-[14px] leading-5 text-x-secondary">
                {replyToTweetId
                  ? "Drop an audio reply into the thread, add a caption, and send it live."
                  : "Record or upload audio, trim it before posting, and let AI turn it into text."}
              </p>
            </div>
            {isModal ? (
              <span className="x-pill hidden phone:inline-flex">
                <Sparkles className="h-3.5 w-3.5" />
                AI-ready
              </span>
            ) : null}
          </div>

          <label className="mt-5 block">
            <span className="mb-2 block text-[14px] font-medium text-x-secondary">Caption</span>
            <textarea
              className="x-input min-h-[96px] rounded-[20px]"
              maxLength={280}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Add context, the first line people should hear, or a short summary."
              value={caption}
            />
          </label>

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative">
                {isRecording ? <span className="absolute inset-0 rounded-full border border-[#F4212E] animate-pulseRing" /> : null}
                <motion.button
                  animate={isRecording ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                  aria-label={isRecording ? "Stop recording" : "Start recording"}
                  className={[
                    "relative z-[1] flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lift transition",
                    isRecording ? "bg-[#F4212E]" : "bg-x-blue hover:bg-[#1a8cd8]",
                  ].join(" ")}
                  onClick={isRecording ? stopRecording : () => void startRecording()}
                  transition={{ duration: 1.1, repeat: isRecording ? Infinity : 0 }}
                  type="button"
                >
                  {isRecording ? <Pause className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
                </motion.button>
              </div>

              <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] font-semibold text-x-primary transition hover:bg-white/[0.05]">
                <Upload className="h-4 w-4 text-x-blue" />
                Upload file
                <input
                  accept="audio/ogg,audio/webm,audio/wav,audio/x-wav,audio/wave"
                  className="sr-only"
                  onChange={(event) => void loadSelectedFile(event.target.files?.[0] || null)}
                  ref={fileInputRef}
                  type="file"
                />
              </label>

              <div className="min-w-[180px] flex-1 rounded-[20px] border border-x-border bg-x-hover/60 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[15px] font-bold text-x-primary">
                    {isRecording ? "Recording live" : previewUrl ? "Preview ready" : "Ready for audio"}
                  </p>
                  <span className="text-[15px] font-medium text-x-secondary">
                    {isRecording ? formatClock(recordingDuration) : formatDuration(effectiveDuration || previewDuration)}
                  </span>
                </div>
                <p className="mt-1 text-[14px] text-x-secondary">
                  {isRecording
                    ? "Mic input is active. Stop whenever you want to preview the clip."
                    : previewUrl
                      ? previewLabel || "Loaded clip"
                      : "Use your microphone or load a clip from disk."}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[20px] border border-x-border bg-[#0d0f11]">
              <div className={["w-full", isModal ? "min-h-[140px]" : "min-h-[112px]"].join(" ")} ref={waveformContainerRef} />
            </div>

            <AnimatePresence initial={false}>
              {previewUrl ? (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-[20px] border border-x-border bg-x-hover/60 p-4"
                  exit={{ opacity: 0, y: -8 }}
                  initial={{ opacity: 0, y: 8 }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-bold text-x-primary">Preview clip</p>
                      <p className="mt-1 text-[14px] text-x-secondary">
                        {formatDuration(previewCurrentTime)} / {formatDuration(previewDuration)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-x-hover text-x-primary transition hover:bg-[#1e2125]"
                        onClick={() => void togglePreviewPlayback()}
                        type="button"
                      >
                        {isPreviewPlaying ? <Pause className="h-[18px] w-[18px]" /> : <Play className="h-[18px] w-[18px]" />}
                      </button>
                      <button
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-x-hover text-x-primary transition hover:bg-[#1e2125]"
                        onClick={resetPreview}
                        type="button"
                      >
                        <RotateCcw className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 phone:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 flex items-center gap-2 text-[14px] font-medium text-x-secondary">
                        <Scissors className="h-4 w-4" />
                        Trim from
                      </span>
                      <input
                        className="x-input rounded-2xl"
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => setTrimStartSeconds(event.target.value)}
                        placeholder="0"
                        step="0.1"
                        type="number"
                        value={trimStartSeconds}
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 flex items-center gap-2 text-[14px] font-medium text-x-secondary">
                        <Scissors className="h-4 w-4" />
                        Trim to
                      </span>
                      <input
                        className="x-input rounded-2xl"
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => setTrimEndSeconds(event.target.value)}
                        placeholder={previewDuration ? String(previewDuration.toFixed(1)) : "End"}
                        step="0.1"
                        type="number"
                        value={trimEndSeconds}
                      />
                    </label>
                  </div>

                  <p className="mt-3 text-[13px] text-x-secondary">
                    Final clip length: {formatDuration(effectiveDuration || previewDuration)}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {error ? (
            <p className="mt-4 rounded-2xl border border-x-red/40 bg-x-red/10 px-4 py-3 text-[14px] text-red-100">{error}</p>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-3">
            {isModal ? (
              <button
                className="rounded-full px-4 py-2.5 text-[15px] font-bold text-x-primary transition hover:bg-x-hover"
                onClick={() => {
                  resetPreview();
                  onClose?.();
                }}
                type="button"
              >
                Cancel
              </button>
            ) : null}
            <button
              className="inline-flex items-center gap-2 rounded-full bg-x-blue px-5 py-2.5 text-[15px] font-bold text-white transition hover:bg-[#1a8cd8] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!recordingBlob || isUploading}
              onClick={() => void uploadRecording()}
              type="button"
            >
              {isUploading ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : <Send className="h-[18px] w-[18px]" />}
              {isUploading ? "Posting..." : replyToTweetId ? "Reply" : "Post"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
