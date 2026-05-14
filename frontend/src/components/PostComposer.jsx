import { LoaderCircle, Lock, Mic, Pause, Play, Send, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError, apiFetch } from "../api/client";
import ConfirmDialog from "./ConfirmDialog.jsx";
import "./PostComposer.css";

const MIME_PRIORITY = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"];
const MIME_EXTENSION_MAP = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};
const RECORDING_WINDOW_SECONDS = 15;
const RECORDING_MIN_DISPLAY_SECONDS = 4;
const RECORDING_SAMPLE_INTERVAL_MS = 30;
const PLAYBACK_RATES = [1, 1.5, 2, 0.75];

const pickMime = () => (typeof MediaRecorder === "undefined" ? "" : MIME_PRIORITY.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? "");

function readCssVariable(name, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) {
    return "0:00";
  }

  const safeValue = Math.max(0, value);
  return `${Math.floor(safeValue / 60)}:${String(Math.floor(safeValue % 60)).padStart(2, "0")}`;
}

function getUploadErrorMessage(error) {
  const message = error instanceof ApiError ? error.message : "";
  const normalized = message.toLowerCase();
  if (normalized.includes("duration") || normalized.includes("длитель") || normalized.includes("ffprobe")) {
    return "Не удалось прочитать длительность. Попробуйте WAV/MP3 или перезапишите.";
  }

  return message || "Не удалось загрузить аудио.";
}

function clamp(value, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, max)) : 0;
}

function normalizeTrimValue(value, fallback, precision = 1) {
  return Number(Math.max(0, value).toFixed(precision)) === Number(fallback.toFixed(precision))
    ? ""
    : String(Number(value.toFixed(precision)));
}

function getRecordingDisplayDuration(seconds) {
  return seconds > RECORDING_WINDOW_SECONDS ? RECORDING_WINDOW_SECONDS : Math.max(seconds + 1, RECORDING_MIN_DISPLAY_SECONDS);
}

function getRecordingPlayheadPercent(seconds, displayDuration) {
  if (seconds > RECORDING_WINDOW_SECONDS) {
    return 95;
  }

  return displayDuration ? Math.min(95, (seconds / displayDuration) * 100) : 0;
}

function drawRoundedRect(context, x, y, width, height, radius) {
  if (typeof context.roundRect === "function") {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fill();
    return;
  }

  context.fillRect(x, y, width, height);
}

function buildWaveformPeaks(audioBuffer, count = 150) {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const channelLength = audioBuffer.length;
  const samplesPerBar = Math.max(1, Math.floor(channelLength / count));

  return Array.from({ length: count }, (_, barIndex) => {
    const start = barIndex * samplesPerBar;
    const end = Math.min(channelLength, start + samplesPerBar);
    let peak = 0;
    let sum = 0;
    let sampleCount = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let index = start; index < end; index += 1) {
        const absolute = Math.abs(data[index] || 0);
        peak = Math.max(peak, absolute);
        sum += absolute * absolute;
        sampleCount += 1;
      }
    }

    const rms = sampleCount ? Math.sqrt(sum / sampleCount) : 0;
    return Math.min(1, rms * 3.2 + peak * 0.35);
  });
}

function getTimelineTicks(duration) {
  if (!duration) {
    return [];
  }

  const nice = [0.5, 1, 2, 5, 10, 15, 30, 60];
  const step = nice.find((item) => item >= duration / 5) ?? 60;
  const ticks = [];

  for (let time = 0; time <= duration + 0.001; time += step) {
    ticks.push({
      label: formatSeconds(time),
      left: `${Math.min(100, (time / duration) * 100)}%`,
      value: time,
    });
  }

  return ticks;
}

export default function PostComposer({ onClose, onCreated, replyToTweetId = null, variant = "inline" }) {
  const [audioLevel, setAudioLevel] = useState(0);
  const [blob, setBlob] = useState(null);
  const [caption, setCaption] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingLocked, setIsRecordingLocked] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [mimeType, setMimeType] = useState("");
  const [playbackRate, setPlaybackRate] = useState(1);
  const [previewUrl, setPreviewUrl] = useState("");
  const [recordCancelOffset, setRecordCancelOffset] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [trimEnd, setTrimEnd] = useState("");
  const [trimStart, setTrimStart] = useState("");
  const [waveformPeaks, setWaveformPeaks] = useState([]);

  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioRef = useRef(null);
  const fileRef = useRef(null);
  const isSeekingRef = useRef(false);
  const seekWasPlayingRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const recordingCanvasRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingDiscardRef = useRef(false);
  const recordingFrameRef = useRef(0);
  const recordingLastLevelAtRef = useRef(0);
  const recordingLastSampleAtRef = useRef(0);
  const recordingLastStateAtRef = useRef(0);
  const recordingPeaksRef = useRef([]);
  const recordingStartedAtRef = useRef(0);
  const recordGestureStartRef = useRef(null);
  const urlRef = useRef("");
  const waveformZoneRef = useRef(null);

  const hasAudio = Boolean(previewUrl);
  const trimmedStart = clamp(trimStart, duration || 0);
  const trimmedEnd = trimEnd === "" ? null : clamp(trimEnd, duration || 0);
  const trimWindowEnd = trimmedEnd ?? duration;
  const effectiveDuration = useMemo(() => (duration ? Math.max(0, trimWindowEnd - trimmedStart) : 0), [duration, trimWindowEnd, trimmedStart]);
  const recordingSeconds = recordingDuration / 1000;
  const recordingDisplayDuration = getRecordingDisplayDuration(recordingSeconds);
  const trimStartPercent = duration ? (trimmedStart / duration) * 100 : 0;
  const trimEndPercent = duration ? (trimWindowEnd / duration) * 100 : 100;
  const trimStartHandlePercent = duration ? Math.max(1, Math.min(99, trimStartPercent)) : 1;
  const trimEndHandlePercent = duration ? Math.max(1, Math.min(99, trimEndPercent)) : 99;
  const playheadPercent = duration ? (Math.min(currentTime, duration) / duration) * 100 : 0;
  const composerState = isRecording ? "recording" : hasAudio ? "preview" : "idle";
  const quietHintVisible = isRecording && recordingSeconds > 3 && audioLevel < 0.035;
  const audioLevelTone = isRecording && audioLevel < 0.035 ? "quiet" : "good";
  const timelineTicks = useMemo(() => getTimelineTicks(duration), [duration]);

  const stopRecordingResources = () => {
    if (recordingFrameRef.current) {
      cancelAnimationFrame(recordingFrameRef.current);
      recordingFrameRef.current = 0;
    }

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const decodePreview = async (nextBlob) => {
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }

      const context = new AudioContextCtor();
      const arrayBuffer = await nextBlob.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));

      setDuration(audioBuffer.duration || 0);
      setWaveformPeaks(buildWaveformPeaks(audioBuffer));
      setCurrentTime(0);
      setTrimStart("");
      setTrimEnd("");
      await context.close().catch(() => {});
    } catch {
      setWaveformPeaks([]);
    }
  };

  const resetPreview = () => {
    const isDiscardingActiveRecording = mediaRecorderRef.current?.state === "recording";
    if (isDiscardingActiveRecording) {
      recordingDiscardRef.current = true;
      mediaRecorderRef.current.stop();
    } else {
      stopRecordingResources();
    }

    audioRef.current?.pause();
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
    }
    urlRef.current = "";

    setAudioLevel(0);
    setBlob(null);
    setCurrentTime(0);
    setDuration(0);
    setError("");
    setIsPlaying(false);
    setIsRecordingLocked(false);
    setPreviewUrl("");
    setRecordCancelOffset(0);
    setRecordingDuration(0);
    setTrimEnd("");
    setTrimStart("");
    setWaveformPeaks([]);
    recordingChunksRef.current = [];
    recordingPeaksRef.current = [];
    recordGestureStartRef.current = null;
    recordingLastSampleAtRef.current = 0;
    recordingLastStateAtRef.current = 0;
    recordingLastLevelAtRef.current = 0;
    recordingStartedAtRef.current = 0;

    if (!isDiscardingActiveRecording) {
      recordingDiscardRef.current = false;
    }

    if (fileRef.current) {
      fileRef.current.value = "";
    }
  };

  const requestClose = () => {
    resetPreview();
    setCaption("");
    setIsDeleteConfirmOpen(false);
    onClose?.();
  };

  useEffect(
    () => () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
      if (mediaRecorderRef.current?.state === "recording") {
        recordingDiscardRef.current = true;
        mediaRecorderRef.current.stop();
      }
      audioRef.current?.pause();
      stopRecordingResources();
    },
    [],
  );

  useEffect(() => {
    const canvas = recordingCanvasRef.current;
    const zone = waveformZoneRef.current;
    const analyser = analyserRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !zone || !analyser || !context || !isRecording) {
      return undefined;
    }

    const sampleBuffer = new Float32Array(analyser.fftSize);
    const drawRecordingFrame = () => {
      if (mediaRecorderRef.current?.state !== "recording") {
        return;
      }

      const now = performance.now();
      const elapsedMs = recordingStartedAtRef.current ? now - recordingStartedAtRef.current : 0;
      const elapsedSeconds = elapsedMs / 1000;

      if (now - recordingLastStateAtRef.current >= 70) {
        recordingLastStateAtRef.current = now;
        setRecordingDuration(elapsedMs);
      }

      if (now - recordingLastSampleAtRef.current >= RECORDING_SAMPLE_INTERVAL_MS) {
        recordingLastSampleAtRef.current = now;
        analyser.getFloatTimeDomainData(sampleBuffer);

        let peak = 0;
        let sum = 0;
        for (let index = 0; index < sampleBuffer.length; index += 1) {
          const absolute = Math.abs(sampleBuffer[index]);
          peak = Math.max(peak, absolute);
          sum += absolute * absolute;
        }

        const rms = Math.sqrt(sum / sampleBuffer.length);
        const previous = recordingPeaksRef.current.at(-1)?.value ?? 0;
        const level = Math.min(1, peak * 0.46 + rms * 3.1);
        const value = Math.min(1, Math.max(0.004, previous * 0.5 + level * 0.5));
        recordingPeaksRef.current.push({ time: elapsedSeconds, value });

        if (now - recordingLastLevelAtRef.current >= 100) {
          recordingLastLevelAtRef.current = now;
          setAudioLevel(value);
        }

        const oldestVisibleTime = Math.max(0, elapsedSeconds - RECORDING_WINDOW_SECONDS - 1);
        if (oldestVisibleTime > 0) {
          recordingPeaksRef.current = recordingPeaksRef.current.filter((item) => item.time >= oldestVisibleTime);
        }
      }

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = window.devicePixelRatio || 1;

      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const centerY = height / 2;
      context.fillStyle = "rgba(255,255,255,0.06)";
      context.fillRect(0, centerY, width, 1);

      const displayDuration = getRecordingDisplayDuration(elapsedSeconds);
      const nextPlayhead = getRecordingPlayheadPercent(elapsedSeconds, displayDuration);
      const playheadX = (nextPlayhead / 100) * width;
      const sliding = elapsedSeconds > RECORDING_WINDOW_SECONDS;
      const visibleStart = sliding ? Math.max(0, elapsedSeconds - RECORDING_WINDOW_SECONDS) : 0;
      const visibleDuration = sliding ? RECORDING_WINDOW_SECONDS : displayDuration;
      const drawableWidth = sliding ? width * 0.95 : width;
      const stride = 5;
      const barWidth = 3;
      const bins = new Map();

      for (const item of recordingPeaksRef.current) {
        if (item.time < visibleStart || item.time > elapsedSeconds + 0.1) {
          continue;
        }

        const x = ((item.time - visibleStart) / Math.max(visibleDuration, 0.001)) * drawableWidth;
        if (x < 0 || x > width) {
          continue;
        }

        const bucket = Math.floor(x / stride);
        bins.set(bucket, Math.max(bins.get(bucket) ?? 0, item.value));
      }

      const primary = readCssVariable("--voice-recorder-primary", "#2ee6cf");
      const quiet = readCssVariable("--voice-recorder-wave-muted", "#153f3c");
      for (const [bucket, value] of bins) {
        const x = bucket * stride;
        const barHeight = Math.max(2, value * (height / 2) * 0.9);
        context.fillStyle = value < 0.05 ? quiet : primary;
        drawRoundedRect(context, x, centerY - barHeight, barWidth, barHeight * 2, 2);
      }

      zone.style.setProperty("--live-playhead-x", `${playheadX}px`);
      recordingFrameRef.current = requestAnimationFrame(drawRecordingFrame);
    };

    recordingFrameRef.current = requestAnimationFrame(drawRecordingFrame);
    return () => {
      if (recordingFrameRef.current) {
        cancelAnimationFrame(recordingFrameRef.current);
        recordingFrameRef.current = 0;
      }
    };
  }, [isRecording]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !hasAudio) {
      return undefined;
    }

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = window.devicePixelRatio || 1;

      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const centerY = height / 2;
      context.fillStyle = "rgba(255,255,255,0.06)";
      context.fillRect(0, centerY, width, 1);

      const primary = readCssVariable("--voice-recorder-primary", "#2ee6cf");
      const wave = readCssVariable("--voice-recorder-wave", "#1d7d72");
      const trimmed = readCssVariable("--voice-recorder-wave-trimmed", "#0d2c2a");
      const quiet = readCssVariable("--voice-recorder-wave-muted", "#153f3c");
      const peaks = waveformPeaks.length ? waveformPeaks : Array.from({ length: 120 }, (_, index) => (index % 9 === 0 ? 0.2 : 0.06));
      const stride = width / peaks.length;
      const barWidth = Math.max(2, Math.min(4, stride * 0.55));
      const playedFraction = duration ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
      const startFraction = duration ? trimmedStart / duration : 0;
      const endFraction = duration ? trimWindowEnd / duration : 1;

      peaks.forEach((value, index) => {
        const fraction = index / Math.max(1, peaks.length - 1);
        const x = index * stride;
        const inTrim = fraction >= startFraction && fraction <= endFraction;
        const isPlayed = fraction <= playedFraction;
        const barHeight = Math.max(2, value * (height / 2) * 0.94);

        context.fillStyle = !inTrim ? trimmed : value < 0.035 ? quiet : isPlayed ? primary : wave;
        drawRoundedRect(context, x, centerY - barHeight, barWidth, barHeight * 2, 2);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [currentTime, duration, hasAudio, trimWindowEnd, trimmedStart, waveformPeaks]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const loadPreviewBlob = async (nextBlob, nextMimeType) => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
    }

    const preview = URL.createObjectURL(nextBlob);
    urlRef.current = preview;
    setBlob(nextBlob);
    setPreviewUrl(preview);
    setMimeType(nextMimeType || nextBlob.type || "audio/webm");
    setError("");
    setIsPlaying(false);
    setCurrentTime(0);
    await decodePreview(nextBlob);
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Браузер не поддерживает запись аудио.");
      }

      resetPreview();
      const selectedMime = pickMime();
      setMimeType(selectedMime || "audio/ogg");
      recordingChunksRef.current = [];
      recordingPeaksRef.current = [];
      recordingDiscardRef.current = false;
      recordingLastSampleAtRef.current = 0;
      recordingLastStateAtRef.current = performance.now();
      recordingLastLevelAtRef.current = 0;
      recordingStartedAtRef.current = 0;
      setAudioLevel(0);
      setError("");
      setRecordingDuration(0);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      });
      mediaStreamRef.current = stream;

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);

      let mediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, {
          ...(selectedMime ? { mimeType: selectedMime } : {}),
          audioBitsPerSecond: 128000,
        });
      } catch {
        mediaRecorder = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);
      }

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        setError(event.error?.message || "Не удалось записать аудио.");
        recordingDiscardRef.current = true;
        setIsRecording(false);
        stopRecordingResources();
      };

      mediaRecorder.onstop = async () => {
        const shouldDiscard = recordingDiscardRef.current;
        const recordedType = mediaRecorder.mimeType || selectedMime || "audio/webm";
        const nextBlob = new Blob(recordingChunksRef.current, { type: recordedType });

        stopRecordingResources();
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setIsRecordingLocked(false);
        setRecordCancelOffset(0);

        if (shouldDiscard || !nextBlob.size) {
          recordingDiscardRef.current = false;
          recordingChunksRef.current = [];
          recordingPeaksRef.current = [];
          return;
        }

        await loadPreviewBlob(nextBlob, recordedType);
      };

      mediaRecorder.start(120);
      recordingStartedAtRef.current = performance.now();
      setIsRecording(true);
      setIsRecordingLocked(false);
      setRecordCancelOffset(0);
      navigator.vibrate?.(12);
    } catch (caughtError) {
      stopRecordingResources();
      mediaRecorderRef.current = null;
      setError(caughtError?.message || "Не удалось начать запись.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    setIsRecordingLocked(false);
    setRecordCancelOffset(0);
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }

    setIsRecording(false);
    stopRecordingResources();
  };

  const cancelRecording = () => {
    recordingDiscardRef.current = true;
    setIsRecordingLocked(false);
    setRecordCancelOffset(0);
    recordGestureStartRef.current = null;
    navigator.vibrate?.([12, 24, 12]);

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }

    setIsRecording(false);
    stopRecordingResources();
  };

  const loadFile = async (file) => {
    if (!file) {
      return;
    }

    try {
      resetPreview();
      await loadPreviewBlob(file, file.type || "audio/webm");
    } catch (caughtError) {
      setError(getUploadErrorMessage(caughtError) || caughtError?.message || "Не удалось загрузить файл.");
    }
  };

  const openFileDialog = () => {
    fileRef.current?.click();
  };

  const seekWaveformToPointer = (clientX) => {
    const zone = waveformZoneRef.current;
    if (!zone || !duration) {
      return 0;
    }

    const rect = zone.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return fraction * duration;
  };

  const seekToTime = async (nextTime) => {
    const audio = audioRef.current;
    if (!audio || !hasAudio || !duration) {
      return;
    }

    const boundedTime = Math.min(Math.max(nextTime, trimmedStart), trimWindowEnd || duration);
    const wasPlaying = !audio.paused;

    audio.pause();
    audio.currentTime = boundedTime;
    setCurrentTime(boundedTime);

    if (wasPlaying) {
      await audio.play().catch(() => setIsPlaying(false));
    }
  };

  const applySeekPosition = (nextTime) => {
    const audio = audioRef.current;
    if (!audio || !hasAudio || !duration) {
      return;
    }

    const boundedTime = Math.min(Math.max(nextTime, trimmedStart), trimWindowEnd || duration);
    audio.currentTime = boundedTime;
    setCurrentTime(boundedTime);
  };

  const handleWaveformSeekStart = (event) => {
    if (!hasAudio || !duration || event.target.closest("button")) {
      return;
    }

    const audio = audioRef.current;
    seekWasPlayingRef.current = Boolean(audio && !audio.paused);
    audio?.pause();
    isSeekingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    applySeekPosition(seekWaveformToPointer(event.clientX));
  };

  const handleWaveformSeekMove = (event) => {
    if (!isSeekingRef.current) {
      return;
    }

    applySeekPosition(seekWaveformToPointer(event.clientX));
  };

  const finishWaveformSeek = async (event) => {
    if (!isSeekingRef.current) {
      return;
    }

    applySeekPosition(seekWaveformToPointer(event.clientX));
    isSeekingRef.current = false;

    if (seekWasPlayingRef.current) {
      await audioRef.current?.play().catch(() => setIsPlaying(false));
    }
    seekWasPlayingRef.current = false;
  };

  const cancelWaveformSeek = async () => {
    if (!isSeekingRef.current) {
      return;
    }

    isSeekingRef.current = false;
    if (seekWasPlayingRef.current) {
      await audioRef.current?.play().catch(() => setIsPlaying(false));
    }
    seekWasPlayingRef.current = false;
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !hasAudio) {
      return;
    }

    if (!audio.paused) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    const nextStart = currentTime < trimmedStart || currentTime >= trimWindowEnd ? trimmedStart : currentTime;
    if (Math.abs(nextStart - currentTime) > 0.04) {
      audio.currentTime = nextStart;
      setCurrentTime(nextStart);
    }

    audio.playbackRate = playbackRate;
    await audio.play().catch((caughtError) => {
      setError(caughtError?.message || "Не удалось воспроизвести аудио.");
      setIsPlaying(false);
    });
  };

  const resetTrimToFull = () => {
    audioRef.current?.pause();
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    setTrimStart("");
    setTrimEnd("");
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const beginTrimDrag = (handle, event) => {
    if (!hasAudio || !duration) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    let nextStart = trimmedStart;
    let nextEnd = trimWindowEnd || duration;
    const minSpan = Math.min(0.2, Math.max(duration * 0.04, 0.05));

    const applyPointer = (clientX) => {
      const pointerTime = seekWaveformToPointer(clientX);

      if (handle === "start") {
        nextStart = Math.min(Math.max(0, pointerTime), Math.max(0, nextEnd - minSpan));
        setTrimStart(normalizeTrimValue(nextStart, 0));
        void seekToTime(nextStart);
        return;
      }

      nextEnd = Math.max(nextStart + minSpan, Math.min(duration, pointerTime));
      if (Math.abs(nextEnd - duration) < 0.05) {
        setTrimEnd("");
      } else {
        setTrimEnd(String(Number(nextEnd.toFixed(1))));
      }

      if (currentTime > nextEnd) {
        void seekToTime(nextStart);
      }
    };

    const handlePointerMove = (moveEvent) => applyPointer(moveEvent.clientX);
    const handlePointerUp = (upEvent) => {
      applyPointer(upEvent.clientX);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    applyPointer(event.clientX);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  const nudgeTrimMarker = (handle, direction) => {
    if (!hasAudio || !duration) {
      return;
    }

    const step = direction * 0.1;
    if (handle === "start") {
      const next = Math.min(trimWindowEnd, Math.max(0, trimmedStart + step));
      setTrimStart(normalizeTrimValue(next, 0));
      void seekToTime(next);
      return;
    }

    const next = Math.min(duration, Math.max(trimmedStart + 0.1, trimWindowEnd + step));
    setTrimEnd(Math.abs(next - duration) < 0.05 ? "" : String(Number(next.toFixed(1))));
  };

  const beginRecordingGesture = (event) => {
    if (!isRecording || event.target.closest("button")) {
      return;
    }

    recordGestureStartRef.current = event.clientX;
    setRecordCancelOffset(0);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const updateRecordingGesture = (event) => {
    if (!isRecording || recordGestureStartRef.current === null) {
      return;
    }

    const delta = Math.min(0, event.clientX - recordGestureStartRef.current);
    setRecordCancelOffset(Math.max(-140, delta));
    if (delta <= -118) {
      cancelRecording();
    }
  };

  const endRecordingGesture = () => {
    recordGestureStartRef.current = null;
    setRecordCancelOffset(0);
  };

  const cyclePlaybackRate = () => {
    setPlaybackRate((current) => {
      const index = PLAYBACK_RATES.indexOf(current);
      return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
    });
  };

  const handleAudioTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || isSeekingRef.current) {
      return;
    }

    const nextTime = audio.currentTime || 0;
    if (nextTime >= trimWindowEnd - 0.025 && duration) {
      audio.pause();
      audio.currentTime = trimmedStart;
      setCurrentTime(trimmedStart);
      setIsPlaying(false);
      return;
    }

    setCurrentTime(nextTime);
  };

  const handleLoadedMetadata = () => {
    const audioDuration = audioRef.current?.duration || 0;
    if (Number.isFinite(audioDuration) && audioDuration > 0 && !duration) {
      setDuration(audioDuration);
    }
  };

  const publish = async () => {
    if (!blob) {
      return;
    }

    if (trimmedEnd !== null && trimmedEnd <= trimmedStart) {
      setError("Конец обрезки должен быть позже начала.");
      return;
    }

    try {
      setIsUploading(true);
      setError("");

      const resolvedMime = blob.type || mimeType || "audio/webm";
      const extension =
        MIME_EXTENSION_MAP[resolvedMime] ||
        (resolvedMime.includes("wav") ? "wav" : resolvedMime.includes("ogg") ? "ogg" : resolvedMime.includes("mpeg") ? "mp3" : "webm");
      const fileName = blob instanceof File && blob.name ? blob.name : `voice.${extension}`;
      const formData = new FormData();

      formData.append("audio", blob instanceof File ? blob : new File([blob], fileName, { type: resolvedMime }));
      formData.append("caption", caption.trim() || " ");
      if (replyToTweetId) {
        formData.append("parent_tweet_id", String(replyToTweetId));
      }
      if (trimmedStart > 0) {
        formData.append("trim_start_seconds", String(trimmedStart));
      }
      if (trimmedEnd !== null && trimmedEnd < duration) {
        formData.append("trim_end_seconds", String(trimmedEnd));
      }

      const created = await apiFetch(replyToTweetId ? `/tweets/${replyToTweetId}/reply` : "/tweets/create", {
        method: "POST",
        body: formData,
      });

      onCreated?.({ ...created, client_simulated: true, client_created_at: Date.now() });
      setCaption("");
      resetPreview();
      onClose?.();
    } catch (caughtError) {
      setError(getUploadErrorMessage(caughtError));
    } finally {
      setIsUploading(false);
    }
  };

  const renderIdle = () => (
    <div className="voice-recorder__state voice-recorder__state--idle">
      <button aria-label="Закрыть окно записи" className="voice-recorder__close" onClick={requestClose} type="button">
        <X size={18} />
      </button>
      <div className="voice-recorder__idle-card">
        <p className="voice-recorder__idle-prompt">Нажмите чтобы начать голосовую запись</p>
        <button aria-label="Начать запись" className="voice-recorder__mic-orb" onClick={() => void startRecording()} type="button">
          <Mic size={42} />
        </button>
        <button className="voice-recorder__upload-link" onClick={openFileDialog} type="button">
          или загрузить файл
        </button>
      </div>
    </div>
  );

  const renderRecording = () => (
    <div className="voice-recorder__state voice-recorder__state--recording">
      <div className="voice-recorder__state-label">ЗАПИСЬ</div>
      <div
        className={["voice-recorder__recording-card", isRecordingLocked ? "is-locked" : ""].join(" ")}
        onPointerCancel={endRecordingGesture}
        onPointerDown={beginRecordingGesture}
        onPointerMove={updateRecordingGesture}
        onPointerUp={endRecordingGesture}
        style={{ "--record-cancel-offset": `${recordCancelOffset}px` }}
      >
        <div className="voice-recorder__recording-topline">
          <span className="voice-recorder__record-dot" aria-hidden="true" />
          <span className="voice-recorder__recording-timer">{formatSeconds(recordingSeconds)}</span>
          <span className="voice-recorder__cancel-hint">← смахни чтобы отменить</span>
        </div>

        <div
          className="voice-recorder__live-wave"
          ref={waveformZoneRef}
          style={{ "--live-playhead-x": `${getRecordingPlayheadPercent(recordingSeconds, recordingDisplayDuration)}%` }}
        >
          <canvas aria-hidden="true" className="voice-recorder__recording-canvas" ref={recordingCanvasRef} />
          <span aria-hidden="true" className="voice-recorder__live-playhead" />
        </div>

        <button
          aria-label="Зафиксировать запись"
          aria-pressed={isRecordingLocked}
          className="voice-recorder__lock-button"
          onClick={() => setIsRecordingLocked((value) => !value)}
          type="button"
        >
          <Lock size={16} />
        </button>

        <div className="voice-recorder__slide-hint" aria-hidden="true">‹ смахни влево</div>

        <button aria-label="Остановить запись" className="voice-recorder__stop-orb" onClick={stopRecording} type="button">
          <Square fill="currentColor" size={22} />
        </button>

        <div className={["voice-recorder__level", `is-${audioLevelTone}`].join(" ")} aria-label="Уровень микрофона">
          <span style={{ height: `${5 + audioLevel * 8}px` }} />
          <span style={{ height: `${7 + audioLevel * 14}px` }} />
          <span style={{ height: `${4 + audioLevel * 10}px` }} />
        </div>

        {quietHintVisible ? <p className="voice-recorder__quiet-hint">Мы тебя слышим, начинай когда готов.</p> : null}
      </div>
    </div>
  );

  const renderPreview = () => (
    <div className="voice-recorder__state voice-recorder__state--preview">
      <button aria-label="Закрыть окно записи" className="voice-recorder__close" onClick={requestClose} type="button">
        <X size={18} />
      </button>

      <div className="voice-recorder__preview-card">
        <div className="voice-recorder__preview-head">
          <button aria-label={isPlaying ? "Пауза" : "Воспроизвести"} className="voice-recorder__preview-play" onClick={() => void togglePlay()} type="button">
            {isPlaying ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <div className="voice-recorder__preview-time" aria-label="Текущее время и длительность">
            {formatSeconds(currentTime)} <span>/</span> {formatSeconds(effectiveDuration || duration)}
          </div>
        </div>

        <div
          className="voice-recorder__wave-editor"
          onPointerCancel={cancelWaveformSeek}
          onPointerDown={handleWaveformSeekStart}
          onPointerMove={handleWaveformSeekMove}
          onPointerUp={finishWaveformSeek}
          ref={waveformZoneRef}
          style={{
            "--playhead": `${playheadPercent}%`,
            "--trim-end": `${trimEndPercent}%`,
            "--trim-end-handle": `${trimEndHandlePercent}%`,
            "--trim-start": `${trimStartPercent}%`,
            "--trim-start-handle": `${trimStartHandlePercent}%`,
            "--trim-size": `${Math.max(0, trimEndPercent - trimStartPercent)}%`,
          }}
        >
          <div className="voice-recorder__timeline" aria-hidden="true">
            {timelineTicks.map((tick) => (
              <span className="voice-recorder__timeline-tick" key={tick.value} style={{ left: tick.left }}>
                {tick.label}
              </span>
            ))}
          </div>
          <canvas aria-hidden="true" className="voice-recorder__preview-canvas" ref={previewCanvasRef} />
          <span aria-hidden="true" className="voice-recorder__trim-selection" />
          <span aria-hidden="true" className="voice-recorder__trim-shadow is-before" />
          <span aria-hidden="true" className="voice-recorder__trim-shadow is-after" />
          <span aria-hidden="true" className="voice-recorder__playhead" />
          <button
            aria-label="Перетащить начало обрезки"
            className="voice-recorder__trim-handle is-start"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") nudgeTrimMarker("start", -1);
              if (event.key === "ArrowRight") nudgeTrimMarker("start", 1);
            }}
            onPointerDown={(event) => beginTrimDrag("start", event)}
            type="button"
          >
            <span />
          </button>
          <button
            aria-label="Перетащить конец обрезки"
            className="voice-recorder__trim-handle is-end"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") nudgeTrimMarker("end", -1);
              if (event.key === "ArrowRight") nudgeTrimMarker("end", 1);
            }}
            onPointerDown={(event) => beginTrimDrag("end", event)}
            type="button"
          >
            <span />
          </button>
        </div>

        <div className="voice-recorder__trim-info">
          <div>
            <span>НАЧАЛО</span>
            <strong>{formatSeconds(trimmedStart)}</strong>
          </div>
          <div>
            <span>КОНЕЦ</span>
            <strong>{formatSeconds(trimWindowEnd)}</strong>
          </div>
          <div>
            <span>ДЛИНА</span>
            <strong>{formatSeconds(effectiveDuration || duration)}</strong>
          </div>
          <button className="voice-recorder__reset-button" onClick={resetTrimToFull} type="button">
            сбросить
          </button>
        </div>

        <div className="voice-recorder__note-wrap">
          <textarea
            className="voice-recorder__note"
            maxLength={280}
            onChange={(event) => setCaption(event.target.value)}
            placeholder={"Добавь заметку или #теги\n(необязательно)"}
            rows={4}
            value={caption}
          />
          <span className="voice-recorder__counter" aria-live="polite">
            {caption.length} / 280
          </span>
        </div>

        <div className="voice-recorder__preview-actions">
          <button aria-label="Удалить запись" className="voice-recorder__trash-button" onClick={() => setIsDeleteConfirmOpen(true)} type="button">
            <Trash2 size={17} />
          </button>
          <button className="voice-recorder__speed-button" onClick={cyclePlaybackRate} type="button">
            {playbackRate}x
          </button>
          <span className="voice-recorder__duration">{formatSeconds(effectiveDuration || duration)}</span>
          <button className="voice-recorder__publish-button" disabled={!blob || isUploading} onClick={() => void publish()} type="button">
            {isUploading ? <LoaderCircle size={18} /> : <Send size={18} />}
            {isUploading ? "Публикация..." : replyToTweetId ? "Ответить" : "Опубликовать"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <section
      aria-label={replyToTweetId ? "Ответить аудио" : "Опубликовать аудио"}
      aria-modal="true"
      className={["voice-recorder-modal", `is-${composerState}`, variant === "modal" ? "is-modal" : ""].join(" ").trim()}
      role="dialog"
    >
      <input
        accept="audio/mpeg,audio/mp3,audio/mp4,audio/m4a,audio/x-m4a,audio/ogg,audio/webm,audio/wav,audio/x-wav,audio/wave"
        className="sr-only"
        onChange={(event) => void loadFile(event.target.files?.[0] || null)}
        ref={fileRef}
        type="file"
      />

      {composerState === "idle" ? renderIdle() : null}
      {composerState === "recording" ? renderRecording() : null}
      {composerState === "preview" ? renderPreview() : null}

      {error ? <p className="voice-recorder__error">{error}</p> : null}

      <audio
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(trimmedStart);
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={handleAudioTimeUpdate}
        preload="metadata"
        ref={audioRef}
        src={previewUrl}
      />

      <ConfirmDialog
        confirmLabel="Удалить"
        description="Запись и настройки обрезки будут удалены. Заметка останется."
        onCancel={() => setIsDeleteConfirmOpen(false)}
        onConfirm={() => {
          resetPreview();
          setIsDeleteConfirmOpen(false);
        }}
        open={isDeleteConfirmOpen}
        title="Удалить запись?"
        tone="danger"
      />
    </section>
  );
}
