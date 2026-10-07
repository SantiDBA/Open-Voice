"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  WS_EVENTS,
  createRequestId,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage
} from "@open-gpt-live/protocol";
import {
  LIVE_PCM_MIME_TYPE,
  LIVE_PCM_SAMPLE_RATE,
  Pcm16FrameBuffer,
  StreamingPcm16Resampler
} from "../lib/audio-pcm";
import { resolveVadConfig } from "../lib/live-config";
import {
  AdaptiveVadEngine,
  type SpeechDetector,
  type VadSnapshot
} from "../lib/vad-engine";
import {
  beginLatencyRequest,
  markLatency,
  settleLatencyRequest,
  type LatencyRegistry,
  type LatencyRequestKind,
  type LatencyRequestStatus,
  type LatencySnapshot
} from "../lib/latency-metrics";
import {
  beginRequest,
  canAcceptRequestEvent,
  cancelActiveRequests,
  settleRequest,
  transitionRequest,
  type RequestLifecycleRegistry
} from "../lib/request-lifecycle";
import {
  connectToolChannel,
  describeGateAction,
  describeToolCall,
  type GateRequestEvent,
  type ToolChannelConnection
} from "../lib/tool-channel";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestId: string;
  source?: "text" | "audio";
  transient?: boolean;
}

/**
 * One line in the activity log. The kind is the tag the line carries and the
 * colour it takes: the same phase code the field and the colour strip use, so a
 * line's category is readable from the same vocabulary as the rest of the
 * world. Red stays reserved for a cut.
 */
type LogKind = "system" | "stt" | "llm" | "tts" | "cut" | "error" | "tool" | "gate";

interface LogEvent {
  id: string;
  at: number;
  kind: LogKind;
  text: string;
  /**
   * Set while a stream is open. A later event with the same key replaces the
   * previous line instead of appending, so a partial transcript or a token
   * stream stays one line rather than flooding the log.
   */
  key?: string;
}

/** The tag each log line shows in its second column. */
const LOG_LABELS: Record<LogKind, string> = {
  system: "SYS",
  stt: "STT",
  llm: "LLM",
  tts: "TTS",
  cut: "CUT",
  error: "ERR",
  tool: "TOOL",
  gate: "GATE"
};

/** How many activity lines the log keeps before the oldest fall away. */
const MAX_LOG_EVENTS = 200;

interface QueuedAudioChunk {
  sequence: number;
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * One entry in the catalog: a numbered turn, the request that made it, and the
 * words on both sides of it. Turns are numbered by request id so the number is
 * stable for the life of the session and survives a reload-free re-render.
 */
interface CatalogTurn {
  fac: number;
  requestId: string;
  spoken: string;
  replied: string;
  interrupted: boolean;
  /** Which voice the agent is answering in, derived from its own words. */
  language: "ES" | "EN" | null;
}

/**
 * Which voice will read a reply aloud. The agent routes its speech provider by
 * the language of the text, so this mirrors that choice instead of guessing:
 * Spanish-only characters settle it, otherwise the more frequent function word
 * wins, and an undecidable reply reports null rather than inventing an accent.
 */
function replyLanguage(text: string): "ES" | "EN" | null {
  if (text.trim().length === 0) return null;
  if (/[ñ¿¡áéíóúü]/i.test(text)) return "ES";
  const words = text.toLowerCase().split(/[^a-záéíóúüñ']+/);
  const spanish = words.filter((w) =>
    ["que", "de", "la", "el", "los", "para", "como", "con", "muy", "porque", "hola", "gracias", "puedes", "puedo"].includes(w)
  ).length;
  const english = words.filter((w) =>
    ["the", "is", "and", "to", "of", "you", "what", "with", "hello", "thanks", "i", "can", "help"].includes(w)
  ).length;
  if (spanish > english) return "ES";
  if (english > spanish) return "EN";
  return null;
}

/** Folds the flat message list into numbered catalog entries. */
function buildCatalogTurns(messages: ChatMessage[]): CatalogTurn[] {
  const byRequest = new Map<string, CatalogTurn>();
  for (const message of messages) {
    let turn = byRequest.get(message.requestId);
    if (!turn) {
      turn = {
        fac: byRequest.size,
        requestId: message.requestId,
        spoken: "",
        replied: "",
        interrupted: false,
        language: null
      };
      byRequest.set(message.requestId, turn);
    }
    if (message.role === "user") {
      turn.spoken = turn.spoken || message.content;
    } else {
      turn.replied += message.content;
      turn.interrupted = Boolean(message.transient);
    }
  }
  for (const turn of byRequest.values()) {
    turn.language = replyLanguage(turn.replied || turn.spoken);
  }
  return [...byRequest.values()];
}

interface PlaybackQueue {
  requestId: string;
  chunks: Map<number, QueuedAudioChunk>;
  nextSequence: number;
  ended: boolean;
  playing: boolean;
}

/**
 * A decoded reply that could not be started because the Web Audio context was
 * suspended by the browser's autoplay policy. The bytes are kept so the user's
 * click can resume the context and play them without re-fetching.
 */
interface BlockedPlayback {
  requestId: string;
  sequence: number;
  buffer: AudioBuffer;
}

/**
 * One reply segment being sounded through the Web Audio graph (M3). The
 * `source` is stopped by `finish()` when the buffer runs out; `analyser` taps
 * the same signal so the plot can measure the agent's real amplitude.
 */
interface ActivePlayback {
  source: AudioBufferSourceNode;
  analyser: AnalyserNode;
}

interface PushToTalkRecording {
  requestId: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  mimeType: string;
  sequence: number;
  pendingSends: Array<Promise<void>>;
  cancelled: boolean;
  finalizing: boolean;
}

interface LivePcmFrame {
  samples: Int16Array;
  durationMs: number;
}

interface LivePcmTurn {
  requestId: string;
  sequence: number;
  startedAt: number;
  cancelled: boolean;
}

interface VadWorkletFrame {
  rms?: number;
  pcm?: ArrayBuffer;
  sampleRate?: number;
}

type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

const gatewayUrl =
  process.env.NEXT_PUBLIC_GATEWAY_WS_URL ?? "ws://localhost:8787";

/** The agent's tool channel: tool activity and approval requests. */
const toolsChannelUrl =
  process.env.NEXT_PUBLIC_TOOLS_WS_URL ?? "ws://localhost:8788";

const vadConfig = resolveVadConfig({
  adaptiveEnabled: process.env.NEXT_PUBLIC_VAD_ADAPTIVE_ENABLED,
  calibrationMs: process.env.NEXT_PUBLIC_VAD_CALIBRATION_MS,
  noiseFloorSmoothing: process.env.NEXT_PUBLIC_VAD_NOISE_FLOOR_SMOOTHING,
  speechNoiseMultiplier:
    process.env.NEXT_PUBLIC_VAD_SPEECH_NOISE_MULTIPLIER,
  silenceNoiseMultiplier:
    process.env.NEXT_PUBLIC_VAD_SILENCE_NOISE_MULTIPLIER,
  dynamicSpeechMin: process.env.NEXT_PUBLIC_VAD_DYNAMIC_SPEECH_MIN,
  dynamicSpeechMax: process.env.NEXT_PUBLIC_VAD_DYNAMIC_SPEECH_MAX,
  dynamicSilenceMin: process.env.NEXT_PUBLIC_VAD_DYNAMIC_SILENCE_MIN,
  dynamicSilenceMax: process.env.NEXT_PUBLIC_VAD_DYNAMIC_SILENCE_MAX,
  speechThreshold: process.env.NEXT_PUBLIC_VAD_SPEECH_THRESHOLD,
  silenceThreshold: process.env.NEXT_PUBLIC_VAD_SILENCE_THRESHOLD,
  startDebounceMs: process.env.NEXT_PUBLIC_VAD_START_DEBOUNCE_MS,
  minimumSpeechMs: process.env.NEXT_PUBLIC_VAD_MIN_SPEECH_MS,
  hangoverMs: process.env.NEXT_PUBLIC_VAD_HANGOVER_MS,
  maxTurnMs: process.env.NEXT_PUBLIC_VAD_MAX_TURN_MS,
  preRollMs: process.env.NEXT_PUBLIC_VAD_PRE_ROLL_MS,
  playbackThresholdMultiplier:
    process.env.NEXT_PUBLIC_VAD_PLAYBACK_THRESHOLD_MULTIPLIER,
  playbackSuppressAfterEndMs:
    process.env.NEXT_PUBLIC_VAD_PLAYBACK_SUPPRESS_AFTER_END_MS
});

// MediaRecorder is retained for push-to-talk; live mode sends PCM from the worklet.
const recorderTimesliceMs = 250;
const reconnectBaseDelayMs = 500;
const reconnectMaximumDelayMs = 8_000;

/**
 * The one colour each phase owns, written as the literal values the tokens
 * resolve to on the canvas. They match `--color-idle`, `--color-transcribing`,
 * `--color-thinking` and `--color-speaking`. Red is deliberately absent: a cut
 * is permanent and lives in the index as a strike, so the live trace is never
 * red.
 */
const PLOT_TRACE_COLORS = {
  idle: "hsl(210, 10%, 40%)",
  transcribing: "hsl(210, 80%, 50%)",
  thinking: "hsl(50, 80%, 50%)",
  speaking: "hsl(40, 60%, 80%)"
} as const;

/** How many bars the field draws around its ring. */
const PLOT_BAR_COUNT = 72;

export default function Home() {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectNowRef = useRef<(() => void) | null>(null);
  const pttRecordingRef = useRef<PushToTalkRecording | null>(null);
  const pttPermissionPendingRef = useRef(false);
  const pttStartCancelledRef = useRef(false);
  /**
   * The metering graph push-to-talk builds over its stream. It exists
   * only so the field lights up while the user talks, exactly as live
   * mode's tap does; nothing is ever played through it.
   */
  const pttMeterContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveModeGenerationRef = useRef(0);
  const livePcmTurnRef = useRef<LivePcmTurn | null>(null);
  const preRollFramesRef = useRef<LivePcmFrame[]>([]);
  const requestLifecyclesRef = useRef<RequestLifecycleRegistry>(new Map());
  const latencyRegistryRef = useRef<LatencyRegistry>(new Map());
  const activeRequestIdRef = useRef<string | null>(null);
  const playbackQueuesRef = useRef<Map<string, PlaybackQueue>>(new Map());
  const ignoredPlaybackRequestsRef = useRef<Set<string>>(new Set());
  /** The reply segment currently sounding, held so a cut can stop it at once. */
  const currentPlaybackRef = useRef<ActivePlayback | null>(null);
  const blockedPlaybackRef = useRef<BlockedPlayback | null>(null);
  const playbackVadSuppressedUntilRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  /**
   * The Web Audio graph that sounds the agent's voice. Playback used to run
   * through an `HTMLAudioElement` outside this graph, which meant there was no
   * amplitude to sample while the agent spoke and the plot rested at the
   * baseline for the whole half of the conversation the agent owns. The graph
   * is kept alive for the session because closing and reopening it per reply
   * would re-trigger the browser's autoplay prompt.
   */
  const playbackContextRef = useRef<AudioContext | null>(null);
  /**
   * Real microphone amplitude, tapped from the same context the VAD already
   * runs on. The plot is driven by this reading and by nothing else, so the
   * field never moves on a signal that does not exist.
   */
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  /** Mirrors `recording` for effects that must not re-run on state. */
  const recordingRef = useRef(false);
  /**
   * Scratch buffers for the field's spectrum readings: one for the
   * microphone's tap, one for the agent's playback. Sized to the
   * analyser they are read from, whenever that analyser changes.
   */
  const micFrequencyBufferRef = useRef<Float32Array | null>(null);
  const playbackFrequencyBufferRef = useRef<Float32Array | null>(null);
  /**
   * The user's microphone decision (M1). This is a user choice, not a mode: it
   * is deliberately independent of Live mode, so muting the microphone survives
   * turning Live on and off. Mirrored in a ref so audio paths read it without
   * re-subscribing to state.
   */
  const micEnabledRef = useRef(true);
  const vadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vadWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const vadScriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const vadMuteGainRef = useRef<GainNode | null>(null);
  const fallbackResamplerRef = useRef<StreamingPcm16Resampler | null>(null);
  const fallbackFrameBufferRef = useRef<Pcm16FrameBuffer | null>(null);
  const speechDetectorRef = useRef<SpeechDetector | null>(null);
  const lastVadUiUpdateAtRef = useRef(0);
  const liveModeRef = useRef(false);
  const liveListeningRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [recording, setRecording] = useState(false);
  /** Microphone switch (M1): ON means the microphone may capture, OFF does not. */
  const [micEnabled, setMicEnabled] = useState(true);
  const [recordingStatus, setRecordingStatus] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [turnAnnouncement, setTurnAnnouncement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [manualPlaybackRequestId, setManualPlaybackRequestId] = useState<
    string | null
  >(null);
  const [latencySnapshot, setLatencySnapshot] =
    useState<LatencySnapshot | null>(null);
  const [vadSnapshot, setVadSnapshot] = useState<VadSnapshot | null>(null);
  /** The turn pipeline as it happens: the honest record of what the agent did. */
  const [logEvents, setLogEvents] = useState<LogEvent[]>([]);
  /** Mirrors `logEvents` so a writer reads the current list without re-subscribing. */
  const logEventsRef = useRef<LogEvent[]>([]);
  /**
   * An approval the agent is waiting on. At most one at a time: the tool loop
   * runs a single action before it asks the model for the next.
   */
  const [pendingGate, setPendingGate] = useState<GateRequestEvent | null>(null);
  const toolChannelRef = useRef<ToolChannelConnection | null>(null);
  const toolChannelSeenRef = useRef(false);
  /** The two scrolling panels follow their newest line. */
  const dialogueScrollRef = useRef<HTMLDivElement | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  /** Accumulated reply text per request, so the log shows the model's own words. */
  const llmStreamRef = useRef<Map<string, string>>(new Map());
  /** TTS segments counted per request, reported as one coalesced log line. */
  const ttsChunkCountRef = useRef<Map<string, number>>(new Map());

  if (!speechDetectorRef.current) {
    speechDetectorRef.current = new AdaptiveVadEngine(vadConfig);
  }

  const canSend = useMemo(
    () => connected && input.trim().length > 0 && !activeRequestId,
    [activeRequestId, connected, input]
  );

  /** Appends one line to the activity log, dropping the oldest past the cap. */
  function appendLog(kind: LogKind, text: string): void {
    const entry: LogEvent = { id: createRequestId(), at: Date.now(), kind, text };
    const next = trimLog([...logEventsRef.current, entry]);
    logEventsRef.current = next;
    setLogEvents(next);
  }

  /**
   * Appends a line, or replaces the last one when it belongs to the same open
   * stream. A partial transcript and a token stream each stay a single line
   * that grows, instead of one line per event.
   */
  function upsertLog(kind: LogKind, key: string, text: string): void {
    const current = logEventsRef.current;
    const last = current[current.length - 1];
    if (last && last.key === key) {
      const next = [...current.slice(0, -1), { ...last, at: Date.now(), text }];
      logEventsRef.current = next;
      setLogEvents(next);
      return;
    }
    const entry: LogEvent = {
      id: createRequestId(),
      at: Date.now(),
      kind,
      text,
      key
    };
    const next = trimLog([...current, entry]);
    logEventsRef.current = next;
    setLogEvents(next);
  }

  /**
   * Answers the pending approval. Saying nothing is a denial: the gate only
   * closes when a person presses one of these.
   */
  function answerGate(decision: "approve" | "deny"): void {
    const gate = pendingGate;
    if (!gate) {
      return;
    }
    toolChannelRef.current?.decide(gate.toolCallId, decision);
    appendLog("gate", `${decision === "approve" ? "approved" : "denied"} · ${gate.tool}`);
    setPendingGate(null);
  }

  useEffect(() => {
    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) {
        return;
      }

      const delay = Math.min(
        reconnectMaximumDelayMs,
        reconnectBaseDelayMs * 2 ** reconnectAttempt
      );
      reconnectAttempt += 1;
      setConnectionStatus("reconnecting");
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      const currentSocket = socketRef.current;
      if (
        currentSocket &&
        (currentSocket.readyState === WebSocket.CONNECTING ||
          currentSocket.readyState === WebSocket.OPEN)
      ) {
        return;
      }

      setConnectionStatus(reconnectAttempt > 0 ? "reconnecting" : "connecting");

      let socket: WebSocket;
      try {
        socket = new WebSocket(gatewayUrl);
      } catch {
        setConnected(false);
        setConnectionStatus("disconnected");
        setError("Could not connect to the gateway. Retrying automatically...");
        appendLog("error", "gateway connection failed");
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed || socketRef.current !== socket) {
          socket.close();
          return;
        }
        const restoredConnection = reconnectAttempt > 0;
        reconnectAttempt = 0;
        setConnected(true);
        setConnectionStatus("connected");
        setError(
          restoredConnection
            ? "Gateway reconnected. A new session has started."
            : null
        );
        appendLog(
          "system",
          restoredConnection ? "gateway reconnected" : "gateway connected"
        );
      });

      socket.addEventListener("close", () => {
        if (disposed || socketRef.current !== socket) {
          return;
        }

        socketRef.current = null;
        setConnected(false);
        setSessionId(null);
        setConnectionStatus("disconnected");
        cancelRequestsAfterDisconnect();
        setError(
          "Gateway disconnected. Reconnecting automatically; the next connection starts a new session."
        );
        appendLog("system", "gateway disconnected");
        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        if (socketRef.current === socket) {
          setError("Gateway connection failed. Waiting to reconnect...");
          appendLog("error", "gateway connection failed");
        }
      });

      socket.addEventListener("message", (event) => {
        if (disposed || socketRef.current !== socket) {
          return;
        }

        try {
          const result = parseServerMessage(JSON.parse(event.data as string));
          if (!result.success) {
            setError(`Received an invalid gateway message: ${result.error}`);
            return;
          }
          handleServerMessage(result.data);
        } catch {
          setError("Received an invalid gateway message.");
        }
      });
    };

    reconnectNowRef.current = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      connect();
    };

    connect();

    return () => {
      disposed = true;
      reconnectNowRef.current = null;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      cleanupAllPlayback(false);
      // The playback graph is session-lived; release it with the page.
      void playbackContextRef.current?.close().catch(() => undefined);
      playbackContextRef.current = null;
      cleanupLiveMode(false, false);
      cancelPushToTalkRecording(false);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  function handleServerMessage(message: ServerMessage): void {
    if (message.type === WS_EVENTS.SESSION_START) {
      setSessionId(message.sessionId);
      appendLog("system", `session ${message.sessionId.slice(0, 8)}`);
      return;
    }

    if (message.type === WS_EVENTS.LLM_DELTA) {
      if (
        !canAcceptRequestEvent(requestLifecyclesRef.current, message.requestId, [
          "responding",
          "playing"
        ])
      ) {
        return;
      }
      markRequestLatency(message.requestId, "firstLlmDeltaAt");
      const accumulated =
        (llmStreamRef.current.get(message.requestId) ?? "") + message.delta;
      llmStreamRef.current.set(message.requestId, accumulated);
      upsertLog("llm", `llm:${message.requestId}`, `out · ${accumulated}`);
      setMessages((current) =>
        current.map((item) =>
          item.requestId === message.requestId && item.role === "assistant"
            ? { ...item, content: item.content + message.delta }
            : item
        )
      );
      return;
    }

    if (message.type === WS_EVENTS.TRANSCRIPT_PARTIAL) {
      if (
        !canAcceptRequestEvent(requestLifecyclesRef.current, message.requestId, [
          "recording",
          "finalizing",
          "transcribing"
        ])
      ) {
        return;
      }
      markRequestLatency(message.requestId, "firstPartialAt");
      upsertLog("stt", `stt:${message.requestId}`, `partial · ${message.text}`);
      setRecordingStatus("Listening...");
      setMessages((current) => {
        const existing = current.find(
          (item) => item.requestId === message.requestId && item.role === "user"
        );
        if (existing) {
          return current.map((item) =>
            item.id === existing.id
              ? { ...item, content: message.text, transient: true }
              : item
          );
        }

        return [
          ...current,
          {
            id: createRequestId(),
            role: "user",
            content: message.text,
            requestId: message.requestId,
            source: "audio",
            transient: true
          }
        ];
      });
      return;
    }

    if (message.type === WS_EVENTS.TRANSCRIPT_FINAL) {
      if (
        !canAcceptRequestEvent(requestLifecyclesRef.current, message.requestId, [
          "recording",
          "finalizing",
          "transcribing"
        ])
      ) {
        return;
      }
      markRequestLatency(message.requestId, "finalTranscriptAt");
      transitionRequest(
        requestLifecyclesRef.current,
        message.requestId,
        "responding"
      );
      appendLog("stt", `final · ${message.text}`);
      setRecordingStatus(null);
      setMessages((current) => {
        const hasUser = current.some(
          (item) => item.requestId === message.requestId && item.role === "user"
        );
        const hasAssistant = current.some(
          (item) =>
            item.requestId === message.requestId && item.role === "assistant"
        );
        const next = hasUser
          ? current.map((item) =>
              item.requestId === message.requestId && item.role === "user"
                ? { ...item, content: message.text, transient: false }
                : item
            )
          : [
              ...current,
              {
                id: createRequestId(),
                role: "user" as const,
                content: message.text,
                requestId: message.requestId,
                source: "audio" as const
              }
            ];

        return hasAssistant
          ? next
          : [
              ...next,
              {
                id: createRequestId(),
                role: "assistant",
                content: "",
                requestId: message.requestId
              }
            ];
      });
      setTurnAnnouncement("Agent is responding");
      return;
    }

    if (message.type === WS_EVENTS.LLM_DONE) {
      if (
        !canAcceptRequestEvent(requestLifecyclesRef.current, message.requestId)
      ) {
        return;
      }
      appendLog("llm", `done · ${message.reason}`);
      if (message.reason === "interrupted" || message.reason === "error") {
        cancelRequest(
          message.requestId,
          message.reason === "error" ? "error" : "interrupted"
        );
      } else {
        window.setTimeout(() => {
          if (
            canAcceptRequestEvent(
              requestLifecyclesRef.current,
              message.requestId
            ) &&
            !playbackQueuesRef.current.has(message.requestId)
          ) {
            completeRequest(message.requestId);
          }
        }, 250);
      }
      return;
    }

    if (message.type === WS_EVENTS.TTS_START) {
      if (
        ignoredPlaybackRequestsRef.current.has(message.requestId) ||
        !transitionRequest(
          requestLifecyclesRef.current,
          message.requestId,
          "playing"
        )
      ) {
        return;
      }
      setCurrentRequest(message.requestId);
      appendLog("tts", "start · synthesis");
      ttsChunkCountRef.current.set(message.requestId, 0);
      playbackQueuesRef.current.set(message.requestId, {
        requestId: message.requestId,
        chunks: new Map(),
        nextSequence: 0,
        ended: false,
        playing: false
      });
      return;
    }

    if (message.type === WS_EVENTS.TTS_CHUNK) {
      if (
        ignoredPlaybackRequestsRef.current.has(message.requestId) ||
        !canAcceptRequestEvent(
          requestLifecyclesRef.current,
          message.requestId,
          ["playing"]
        )
      ) {
        return;
      }

      const segments =
        (ttsChunkCountRef.current.get(message.requestId) ?? 0) + 1;
      ttsChunkCountRef.current.set(message.requestId, segments);
      upsertLog(
        "tts",
        `tts:${message.requestId}`,
        `streaming · ${segments} segments`
      );
      const queue = getOrCreatePlaybackQueue(message.requestId);
      queue.chunks.set(message.sequence, {
        sequence: message.sequence,
        bytes: base64ToUint8Array(message.chunk),
        mimeType: message.mimeType
      });
      void drainPlaybackQueue(message.requestId);
      return;
    }

    if (message.type === WS_EVENTS.TTS_END) {
      if (
        !canAcceptRequestEvent(requestLifecyclesRef.current, message.requestId)
      ) {
        return;
      }
      const queue = playbackQueuesRef.current.get(message.requestId);
      if (queue) {
        queue.ended = true;
      }
      appendLog("tts", `end · ${message.reason}`);
      if (message.reason !== "stop") {
        cancelRequest(
          message.requestId,
          message.reason === "error" ? "error" : "interrupted"
        );
      } else if (!queue) {
        completeRequest(message.requestId);
      } else {
        void drainPlaybackQueue(message.requestId);
      }
      return;
    }

    if (message.type === "error") {
      if (
        message.requestId &&
        !canAcceptRequestEvent(requestLifecyclesRef.current, message.requestId)
      ) {
        return;
      }
      setError(message.message);
      appendLog("error", message.message);
      if (message.requestId) {
        cancelRequest(message.requestId, "error");
      }
    }
  }

  function sendMessage(): void {
    const text = input.trim();
    const socket = socketRef.current;
    if (!socket || !canSend || !text) {
      return;
    }

    // A click is the gesture the browser needs to sound audio: warm the
    // playback graph so the reply never waits on the autoplay policy.
    warmPlaybackContext();

    const requestId = createRequestId();
    beginRequestLatency(requestId, "text");
    beginRequest(requestLifecyclesRef.current, requestId, "responding");
    setError(null);
    setInput("");
    setCurrentRequest(requestId);
    setTurnAnnouncement("Agent is responding");
    appendLog("llm", `in · ${text}`);
    llmStreamRef.current.set(requestId, "");
    setMessages((current) => [
      ...current,
      {
        id: createRequestId(),
        role: "user",
        content: text,
        requestId,
        source: "text"
      },
      {
        id: createRequestId(),
        role: "assistant",
        content: "",
        requestId
      }
    ]);

    if (!sendRaw(socket, {
      type: WS_EVENTS.USER_TEXT,
      requestId,
      text
    })) {
      cancelRequest(requestId);
      setError("The message was not sent because the gateway disconnected.");
    }
  }

  async function startRecording(): Promise<void> {
    const socket = socketRef.current;
    let requestedStream: MediaStream | null = null;
    if (!socket || !connected || activeRequestId || recording) {
      return;
    }

    // The pointerdown is a user gesture: warm the playback graph now,
    // before any await can expire the browser's transient activation.
    warmPlaybackContext();

    // M1: the switch gates capture. Off means the microphone is closed, so there
    // is no stream to request and no frame to send.
    if (!micEnabledRef.current) {
      setMicError("The microphone switch is off. Turn it on to talk.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicError("This browser does not support microphone recording.");
      return;
    }

    try {
      pttPermissionPendingRef.current = true;
      pttStartCancelledRef.current = false;
      setError(null);
      setMicError(null);
      setRecordingStatus("Requesting microphone permission...");

      const stream = await getAudioInputStream();
      requestedStream = stream;
      const mimeType = selectAudioMimeType();
      const requestId = createRequestId();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      const context: PushToTalkRecording = {
        requestId,
        recorder,
        stream,
        mimeType: recorder.mimeType || mimeType || "audio/webm",
        sequence: 0,
        pendingSends: [],
        cancelled: false,
        finalizing: false
      };

      pttPermissionPendingRef.current = false;
      if (
        pttStartCancelledRef.current ||
        !connected ||
        socketRef.current !== socket
      ) {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingStatus(null);
        return;
      }

      pttRecordingRef.current = context;
      requestedStream = null;

      // Meter the stream so the field lights up while the user talks,
      // exactly as live mode's tap does. The graph measures only:
      // nothing is ever played through it.
      const AudioContextConstructor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      const meterContext = new AudioContextConstructor();
      const meterSource = meterContext.createMediaStreamSource(stream);
      const meterAnalyser = meterContext.createAnalyser();
      meterAnalyser.fftSize = 1024;
      meterSource.connect(meterAnalyser);
      micAnalyserRef.current = meterAnalyser;
      pttMeterContextRef.current = meterContext;

      beginRequestLatency(requestId, "ptt");
      beginRequest(requestLifecyclesRef.current, requestId, "recording");
      setCurrentRequest(requestId);
      setRecording(true);
    recordingRef.current = true;
      setRecordingStatus("Recording...");
      appendLog("system", "push-to-talk recording");

      recorder.addEventListener("dataavailable", (event) => {
        if (
          context.cancelled ||
          pttRecordingRef.current !== context ||
          event.data.size === 0
        ) {
          return;
        }

        const sequence = context.sequence++;
        const sendPromise = sendAudioBlob(context, event.data, sequence);
        context.pendingSends.push(sendPromise);
      });

      recorder.addEventListener("stop", () => {
        void finalizePushToTalkRecording(context);
      });
      recorder.addEventListener(
        "start",
        () => markRequestLatency(requestId, "speechStartedAt"),
        { once: true }
      );

      recorder.start(recorderTimesliceMs);
    } catch (reason) {
      pttPermissionPendingRef.current = false;
      requestedStream?.getTracks().forEach((track) => track.stop());
      cancelPushToTalkRecording();
      setMicError(
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? "Microphone permission was denied. Text input is still available."
          : "Could not start microphone recording. Text input is still available."
      );
      setRecordingStatus(null);
      clearCurrentRequest();
    }
  }

  function stopRecording(): void {
    if (pttPermissionPendingRef.current) {
      pttStartCancelledRef.current = true;
      setRecordingStatus(null);
      return;
    }

    const context = pttRecordingRef.current;
    if (!context || context.recorder.state === "inactive" || context.finalizing) {
      return;
    }

    context.finalizing = true;
    markRequestLatency(context.requestId, "speechEndedAt");
    transitionRequest(
      requestLifecyclesRef.current,
      context.requestId,
      "finalizing"
    );
    setRecording(false);
    recordingRef.current = false;
    setRecordingStatus("Transcribing...");
    context.recorder.stop();
  }

  async function sendAudioBlob(
    context: PushToTalkRecording,
    blob: Blob,
    sequence: number
  ): Promise<void> {
    const chunk = await blobToBase64(blob);
    const socket = socketRef.current;
    if (
      context.cancelled ||
      !socket ||
      !canAcceptRequestEvent(requestLifecyclesRef.current, context.requestId)
    ) {
      return;
    }

    if (!sendRaw(socket, {
      type: WS_EVENTS.AUDIO_CHUNK,
      requestId: context.requestId,
      chunk,
      mimeType: context.mimeType,
      sequence,
      turnMode: "ptt",
      isFinal: false
    })) {
      throw new Error("gateway disconnected");
    }
  }

  async function finalizePushToTalkRecording(
    context: PushToTalkRecording
  ): Promise<void> {
    try {
      await Promise.all(context.pendingSends);
      const socket = socketRef.current;
      if (
        context.cancelled ||
        !socket ||
        !canAcceptRequestEvent(requestLifecyclesRef.current, context.requestId)
      ) {
        return;
      }

      if (!sendRaw(socket, {
        type: WS_EVENTS.AUDIO_CHUNK,
        requestId: context.requestId,
        mimeType: context.mimeType,
        sequence: context.sequence,
        turnMode: "ptt",
        isFinal: true
      })) {
        throw new Error("gateway disconnected");
      }

      transitionRequest(
        requestLifecyclesRef.current,
        context.requestId,
        "transcribing"
      );
    } catch {
      if (!context.cancelled) {
        setError("Could not send recorded audio.");
        cancelRequest(context.requestId);
        setRecordingStatus(null);
      }
    } finally {
      cleanupPushToTalkRecording(context);
    }
  }

  function cancelPushToTalkRecording(updateUi = true): void {
    pttStartCancelledRef.current = true;
    const context = pttRecordingRef.current;
    if (!context) {
      return;
    }

    context.cancelled = true;
    settleRequest(
      requestLifecyclesRef.current,
      context.requestId,
      "cancelled"
    );
    settleRequestLatency(context.requestId, "interrupted");
    if (context.recorder.state !== "inactive") {
      context.recorder.stop();
    }
    cleanupPushToTalkRecording(context, updateUi);
  }

  function cleanupPushToTalkRecording(
    context: PushToTalkRecording,
    updateUi = true
  ): void {
    context.stream.getTracks().forEach((track) => track.stop());
    if (pttRecordingRef.current === context) {
      pttRecordingRef.current = null;
    }
    // Close the metering graph that lit the field during the turn.
    micAnalyserRef.current?.disconnect();
    micAnalyserRef.current = null;
    if (pttMeterContextRef.current) {
      void pttMeterContextRef.current.close().catch(() => undefined);
      pttMeterContextRef.current = null;
    }
    if (updateUi) {
      setRecording(false);
    recordingRef.current = false;
    }
  }

  function stopResponse(): void {
    const socket = socketRef.current;
    const requestId = activeRequestIdRef.current;
    if (!requestId) {
      return;
    }
    appendLog("cut", "interrupted by user");

    if (livePcmTurnRef.current?.requestId === requestId) {
      cancelLivePcmTurn(true);
    } else {
      cancelRequest(requestId);
    }
    setRecordingStatus(null);
    if (socket) {
      sendRaw(socket, {
        type: WS_EVENTS.INTERRUPT,
        requestId,
        reason: "user clicked stop"
      });
    }
  }

  async function toggleLiveMode(): Promise<void> {
    if (liveModeRef.current) {
      cleanupLiveMode(true);
      appendLog("system", "live mode off");
      return;
    }

    if (!connected || !navigator.mediaDevices?.getUserMedia) {
      setMicError("This browser does not support microphone recording.");
      return;
    }

    // The click is a user gesture: warm the playback graph before the
    // permission await can expire the browser's transient activation.
    warmPlaybackContext();

    try {
      const generation = ++liveModeGenerationRef.current;
      setError(null);
      setMicError(null);
      setRecordingStatus("Starting live mode...");
      const stream = await getAudioInputStream();
      if (
        generation !== liveModeGenerationRef.current ||
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      ) {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingStatus(null);
        return;
      }
      streamRef.current = stream;
      liveModeRef.current = true;
      liveListeningRef.current = true;
      const resetAt = performance.now();
      const resetSnapshot = speechDetectorRef.current?.reset(resetAt) ?? null;
      lastVadUiUpdateAtRef.current = resetAt;
      setVadSnapshot(resetSnapshot);
      await setupVadPipeline(stream);
      setLiveMode(true);
      appendLog("system", "live mode on");
      setRecordingStatus(
        vadConfig.adaptiveEnabled
          ? "Live mode calibrating ambient noise..."
          : "Live mode listening..."
      );
    } catch {
      cleanupLiveMode(false);
      setMicError("Could not start live mode. Text input is still available.");
    }
  }

  /**
   * The microphone switch (M1). Turning it off is a user decision that outlives
   * Live mode: the switch is its own piece of state, so toggling Live on and off
   * never silently reopens the microphone.
   *
   * In-flight turn, chosen behaviour: a turn already in flight is allowed to
   * finish rather than being cut. Cutting a half-spoken utterance would delete a
   * real observation from the catalog, and a live turn that has already sent its
   * start would otherwise hang waiting for an end that nobody would send. So
   * turning the mic off closes the gate immediately — no further frames are
   * captured or sent — and then finalizes whatever turn is open with exactly the
   * audio captured up to that moment. Push-to-talk stops and sends its final
   * frame; an open live turn is closed with a normal `vad.speech_end`. Playback
   * and text are untouched: the switch governs the microphone, not the agent.
   */
  function toggleMicEnabled(): void {
    const next = !micEnabledRef.current;
    micEnabledRef.current = next;
    setMicEnabled(next);
    setError(null);
    setMicError(null);
    appendLog("system", next ? "microphone on" : "microphone off");

    if (next) {
      setRecordingStatus(null);
      return;
    }

    const hadOpenTurn =
      Boolean(livePcmTurnRef.current) || Boolean(pttRecordingRef.current);

    if (recordingRef.current) {
      // Push-to-talk: stop the recorder so the turn finalizes with the audio it
      // already holds instead of being discarded.
      stopRecording();
    }

    if (liveModeRef.current && livePcmTurnRef.current) {
      // Close an open live turn with a normal end so the gateway receives a
      // complete utterance from the frames already sent, rather than one left
      // hanging open forever.
      endLiveSpeechTurn("manual");
    } else if (liveModeRef.current) {
      // No turn open: drop any pre-roll so nothing captured while muted can be
      // prepended to a future turn.
      clearPreRoll();
      speechDetectorRef.current?.cancelTurn(performance.now());
    }

    // When a turn was left to finish it sets its own "Transcribing..." status;
    // only claim the microphone is off when there is nothing in flight.
    if (!hadOpenTurn) {
      setRecordingStatus("Microphone off.");
    }
  }

  async function setupVadPipeline(stream: MediaStream): Promise<void> {
    cleanupVadPipeline();
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    const audioContext = new AudioContextConstructor();
    const source = audioContext.createMediaStreamSource(stream);
    // Tap the live signal for the field before the monitoring gain silences it.
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    micAnalyserRef.current = analyser;
    const muteGain = audioContext.createGain();
    muteGain.gain.value = 0;

    audioContextRef.current = audioContext;
    vadSourceRef.current = source;
    vadMuteGainRef.current = muteGain;

    try {
      await audioContext.audioWorklet.addModule("/vad-worklet.js");
      if (!liveModeRef.current || streamRef.current !== stream) {
        throw new Error("live mode stopped while audio worket was loading");
      }
      const node = new AudioWorkletNode(audioContext, "open-gpt-live-vad");
      node.port.onmessage = (event: MessageEvent<VadWorkletFrame>) => {
        if (
          typeof event.data.rms === "number" &&
          event.data.pcm instanceof ArrayBuffer &&
          event.data.sampleRate === LIVE_PCM_SAMPLE_RATE
        ) {
          handleVadFrame(event.data.rms, new Int16Array(event.data.pcm));
        }
      };
      source.connect(node);
      node.connect(muteGain);
      muteGain.connect(audioContext.destination);
      vadWorkletNodeRef.current = node;
    } catch {
      if (!liveModeRef.current || streamRef.current !== stream) {
        throw new Error("live mode stopped while audio worklet was loading");
      }
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      const resampler = new StreamingPcm16Resampler(audioContext.sampleRate);
      const frameBuffer = new Pcm16FrameBuffer();
      fallbackResamplerRef.current = resampler;
      fallbackFrameBufferRef.current = frameBuffer;
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const resampled = resampler.push(input);
        for (const frame of frameBuffer.push(resampled)) {
          handleVadFrame(calculatePcm16Rms(frame), frame);
        }
      };
      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(audioContext.destination);
      vadScriptProcessorRef.current = processor;
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  }

  function handleVadFrame(rms: number, samples: Int16Array): void {
    if (!liveModeRef.current || !liveListeningRef.current) {
      return;
    }

    // M1: the microphone switch is the capture gate. With it off, live mode may
    // still be toggled on — that is a listening mode, not a decision to
    // capture — but no frame reaches the gateway, so nothing is transmitted.
    if (!micEnabledRef.current) {
      return;
    }

    const now = performance.now();
    const detector = speechDetectorRef.current;
    if (!detector) {
      return;
    }
    const frame: LivePcmFrame = {
      samples,
      durationMs: (samples.length / LIVE_PCM_SAMPLE_RATE) * 1_000
    };
    if (detector.isTurnActive()) {
      sendLivePcmFrame(frame);
    } else {
      appendPreRollFrame(frame);
    }

    const playbackActive = isPlaybackActive();
    const wasCalibrating = detector.getSnapshot().state === "calibrating";
    const result = detector.processFrame({
      rms,
      now,
      playbackActive,
      suppressStartsUntil: playbackVadSuppressedUntilRef.current
    });
    if (result.event || now - lastVadUiUpdateAtRef.current >= 150) {
      lastVadUiUpdateAtRef.current = now;
      setVadSnapshot(result.snapshot);
    }

    if (wasCalibrating && result.snapshot.state !== "calibrating") {
      setRecordingStatus("Live mode listening...");
    }

    if (result.event?.type === "speech_start") {
      startLiveSpeechTurn(rms, result.event.startedAt);
    } else if (result.event?.type === "speech_end") {
      endLiveSpeechTurn(
        result.event.reason === "max_duration" ? "manual" : "silence"
      );
    } else if (result.event?.type === "speech_cancel") {
      cancelLivePcmTurn(true);
      clearPreRoll();
      setRecordingStatus("Live mode listening (short sound ignored)...");
    }
  }

  function startLiveSpeechTurn(rms: number, detectedAt: number): void {
    const socket = socketRef.current;
    if (!socket || livePcmTurnRef.current) {
      speechDetectorRef.current?.cancelTurn(performance.now());
      return;
    }

    const interruptedRequestId =
      activeRequestIdRef.current ?? getActivePlaybackRequestId();
    if (interruptedRequestId) {
      cancelRequest(interruptedRequestId);
      sendRaw(socket, {
        type: WS_EVENTS.INTERRUPT,
        requestId: interruptedRequestId,
        reason: "live mode barge-in"
      });
      appendLog("cut", "barge-in · reply interrupted");
    }

    const requestId = createRequestId();
    const turn: LivePcmTurn = {
      requestId,
      sequence: 0,
      startedAt: detectedAt,
      cancelled: false
    };
    livePcmTurnRef.current = turn;
    beginRequestLatency(requestId, "live", detectedAt);
    markRequestLatency(requestId, "speechStartedAt", detectedAt);
    beginRequest(requestLifecyclesRef.current, requestId, "recording");
    setCurrentRequest(requestId);
    setRecording(true);
    recordingRef.current = true;
    setRecordingStatus("Listening...");
    appendLog("stt", `speech start · rms ${rms.toFixed(3)}`);

    if (!sendRaw(socket, {
      type: WS_EVENTS.VAD_SPEECH_START,
      requestId,
      turnMode: "live",
      startedAt: detectedAt,
      rms
    })) {
      cancelLivePcmTurn(false);
      setError("Could not start the live speech turn because the gateway disconnected.");
      return;
    }

    const preRollFrames = preRollFramesRef.current;
    preRollFramesRef.current = [];
    for (const preRollFrame of preRollFrames) {
      if (livePcmTurnRef.current !== turn) {
        break;
      }
      sendLivePcmFrame(preRollFrame);
    }
  }

  function sendLivePcmFrame(frame: LivePcmFrame): void {
    const turn = livePcmTurnRef.current;
    const socket = socketRef.current;
    if (
      !turn ||
      turn.cancelled ||
      !socket ||
      // M1: no frame is sent while the microphone switch is off.
      !micEnabledRef.current ||
      !canAcceptRequestEvent(requestLifecyclesRef.current, turn.requestId, [
        "recording"
      ])
    ) {
      return;
    }

    const bytes = new Uint8Array(
      frame.samples.buffer,
      frame.samples.byteOffset,
      frame.samples.byteLength
    );
    const sent = sendRaw(socket, {
      type: WS_EVENTS.AUDIO_CHUNK,
      requestId: turn.requestId,
      chunk: uint8ArrayToBase64(bytes),
      mimeType: LIVE_PCM_MIME_TYPE,
      sequence: turn.sequence++,
      turnMode: "live",
      isFinal: false
    });

    if (!sent) {
      cancelLivePcmTurn(false);
      setError("Live audio stopped because the gateway disconnected.");
    }
  }

  function endLiveSpeechTurn(reason: "silence" | "manual"): void {
    const turn = livePcmTurnRef.current;
    livePcmTurnRef.current = null;
    clearPreRoll();
    setRecording(false);
    recordingRef.current = false;
    setRecordingStatus("Transcribing...");
    appendLog("stt", `speech end · ${reason}`);

    if (!turn || turn.cancelled) {
      return;
    }

    const socket = socketRef.current;
    const endedAt = performance.now();
    markRequestLatency(turn.requestId, "speechEndedAt", endedAt);
    if (
      !socket ||
      !sendRaw(socket, {
        type: WS_EVENTS.AUDIO_CHUNK,
        requestId: turn.requestId,
        mimeType: LIVE_PCM_MIME_TYPE,
        sequence: turn.sequence,
        turnMode: "live",
        isFinal: true
      })
    ) {
      cancelRequest(turn.requestId);
      setError("Could not finalize live audio after the gateway disconnected.");
      return;
    }

    sendRaw(socket, {
      type: WS_EVENTS.VAD_SPEECH_END,
      requestId: turn.requestId,
      endedAt,
      durationMs: endedAt - turn.startedAt,
      reason
    });
    transitionRequest(
      requestLifecyclesRef.current,
      turn.requestId,
      "transcribing"
    );
  }

  function appendPreRollFrame(frame: LivePcmFrame): void {
    const frames = preRollFramesRef.current;
    frames.push(frame);
    let durationMs = frames.reduce((sum, item) => sum + item.durationMs, 0);
    while (frames.length > 0 && durationMs > vadConfig.preRollMs) {
      durationMs -= frames.shift()?.durationMs ?? 0;
    }
  }

  function clearPreRoll(): void {
    preRollFramesRef.current = [];
  }

  async function getAudioInputStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  }

  function cleanupLiveMode(notifyGateway = true, updateUi = true): void {
    liveModeGenerationRef.current += 1;
    liveModeRef.current = false;
    liveListeningRef.current = false;
    cancelLivePcmTurn(notifyGateway);
    cleanupVadPipeline();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    clearPreRoll();
    speechDetectorRef.current?.reset(performance.now());
    lastVadUiUpdateAtRef.current = 0;
    if (updateUi) {
      setLiveMode(false);
      setRecording(false);
    recordingRef.current = false;
      setRecordingStatus(null);
      setVadSnapshot(null);
    }
  }

  function cancelLivePcmTurn(notifyGateway: boolean): void {
    const turn = livePcmTurnRef.current;
    if (!turn) {
      return;
    }

    turn.cancelled = true;
    const socket = socketRef.current;
    if (notifyGateway && socket) {
      const cancelledAt = performance.now();
      sendRaw(socket, {
        type: WS_EVENTS.VAD_SPEECH_END,
        requestId: turn.requestId,
        endedAt: cancelledAt,
        durationMs: cancelledAt - turn.startedAt,
        reason: "cancelled"
      });
      sendRaw(socket, {
        type: WS_EVENTS.INTERRUPT,
        requestId: turn.requestId,
        reason: "live mode stopped"
      });
    }
    cancelRequest(turn.requestId);
    setRecordingStatus(null);
  }

  function cleanupVadPipeline(): void {
    vadWorkletNodeRef.current?.port.close();
    vadWorkletNodeRef.current?.disconnect();
    vadWorkletNodeRef.current = null;
    if (vadScriptProcessorRef.current) {
      vadScriptProcessorRef.current.onaudioprocess = null;
      vadScriptProcessorRef.current.disconnect();
      vadScriptProcessorRef.current = null;
    }
    vadSourceRef.current?.disconnect();
    vadSourceRef.current = null;
    // The field's tap hangs off the same source; leaving it connected keeps a
    // live analyser running after live mode ends.
    micAnalyserRef.current?.disconnect();
    micAnalyserRef.current = null;
    vadMuteGainRef.current?.disconnect();
    vadMuteGainRef.current = null;
    fallbackResamplerRef.current = null;
    fallbackFrameBufferRef.current?.clear();
    fallbackFrameBufferRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }

  function isPlaybackActive(): boolean {
    // A queue is `playing` from the moment its segment is taken off the queue
    // until that segment's `onended` advances the sequence, so this is true for
    // exactly the window during which a reply is sounding.
    for (const queue of playbackQueuesRef.current.values()) {
      if (queue.playing) {
        return true;
      }
    }

    return false;
  }

  /**
   * The session-long Web Audio graph replies are sounded through, resumed if a
   * browser suspended it under its autoplay policy.
   */
  function getPlaybackContext(): AudioContext {
    if (playbackContextRef.current) {
      return playbackContextRef.current;
    }
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    const context = new AudioContextConstructor();
    playbackContextRef.current = context;
    return context;
  }

  /**
   * The browser will not start or resume an AudioContext outside a user
   * gesture. Every control that can begin a turn is one, so the playback
   * graph is warmed there: the first reply sounds instead of waiting
   * behind the manual-play affordance.
   */
  function warmPlaybackContext(): void {
    const context = getPlaybackContext();
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
  }

  function stopActivePlayback(): void {
    const active = currentPlaybackRef.current;
    if (!active) {
      return;
    }
    currentPlaybackRef.current = null;
    active.source.onended = null;
    try {
      active.source.stop();
    } catch {
      // Already stopped; nothing to silence.
    }
    active.source.disconnect();
    active.analyser.disconnect();
  }

  function getActivePlaybackRequestId(): string | null {
    for (const queue of playbackQueuesRef.current.values()) {
      if (queue.playing) {
        return queue.requestId;
      }
    }

    return null;
  }

  function getOrCreatePlaybackQueue(requestId: string): PlaybackQueue {
    const existing = playbackQueuesRef.current.get(requestId);
    if (existing) {
      return existing;
    }

    const queue: PlaybackQueue = {
      requestId,
      chunks: new Map(),
      nextSequence: 0,
      ended: false,
      playing: false
    };
    playbackQueuesRef.current.set(requestId, queue);
    return queue;
  }

  async function drainPlaybackQueue(requestId: string): Promise<void> {
    const queue = playbackQueuesRef.current.get(requestId);
    if (!queue || queue.playing || ignoredPlaybackRequestsRef.current.has(requestId)) {
      return;
    }

    const chunk = queue.chunks.get(queue.nextSequence);
    if (!chunk) {
      if (queue.ended && queue.chunks.size === 0) {
        playbackQueuesRef.current.delete(requestId);
        completeRequest(requestId);
      }
      return;
    }

    queue.chunks.delete(queue.nextSequence);
    // Held across the decode await below, so a chunk arriving mid-decode cannot
    // start a second segment and break the reply's order.
    queue.playing = true;

    let buffer: AudioBuffer;
    let context: AudioContext;
    try {
      context = getPlaybackContext();
      if (context.state === "suspended") {
        await context.resume();
      }
      // Decode from the raw bytes the gateway sent. A copy is taken because
      // `decodeAudioData` detaches the buffer it is handed.
      const encoded = chunk.bytes.slice().buffer;
      buffer = await context.decodeAudioData(encoded);
    } catch {
      // Undecodable bytes behave exactly as a failed element did: advance past
      // this segment, acknowledge it, and carry on with the reply.
      advancePlaybackAfterSegment(requestId, chunk.sequence);
      return;
    }

    if (
      ignoredPlaybackRequestsRef.current.has(requestId) ||
      playbackQueuesRef.current.get(requestId) !== queue
    ) {
      // The turn was cut while the segment was decoding; nothing should sound.
      queue.playing = false;
      return;
    }

    if (context.state !== "running") {
      // The browser will not let audio start without a gesture. Hold the
      // decoded segment and offer the same manual-play affordance as before.
      blockedPlaybackRef.current = {
        requestId,
        sequence: chunk.sequence,
        buffer
      };
      setManualPlaybackRequestId(requestId);
      return;
    }

    // Sound the segment through the graph, tapping it with an analyser so the
    // plot measures the agent's real amplitude exactly as it measures the
    // microphone's. The analyser passes the signal through to the speakers.
    startPlaybackSegment(requestId, chunk.sequence, buffer);
  }

  /**
   * Starts a decoded segment on the graph. The analyser taps the same signal and
   * passes it to the speakers, so the agent's own voice is measured exactly as
   * the microphone's is rather than played outside the graph.
   */
  function startPlaybackSegment(
    requestId: string,
    sequence: number,
    buffer: AudioBuffer
  ): void {
    const context = getPlaybackContext();
    const source = context.createBufferSource();
    source.buffer = buffer;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    analyser.connect(context.destination);
    currentPlaybackRef.current = { source, analyser };

    source.onended = () => {
      // A cut stops this node deliberately, which also fires `onended`. The
      // guard makes sure that synthetic end can never advance the reply the cut
      // just cancelled.
      if (currentPlaybackRef.current?.source !== source) {
        return;
      }
      advancePlaybackAfterSegment(requestId, sequence);
    };
    source.start();

    // The mark the world already instruments: the moment audio begins sounding.
    markRequestLatency(requestId, "firstAudioPlaybackAt");
  }

  /**
   * Shared tail of a finished segment: acknowledge it, advance the queue and
   * immediately start the next one, or settle the turn when the reply is done.
   */
  function advancePlaybackAfterSegment(requestId: string, sequence: number): void {
    stopActivePlayback();
    playbackVadSuppressedUntilRef.current =
      performance.now() + vadConfig.playbackSuppressAfterEndMs;
    const currentQueue = playbackQueuesRef.current.get(requestId);
    if (currentQueue) {
      currentQueue.nextSequence = sequence + 1;
      currentQueue.playing = false;
    }
    if (
      !ignoredPlaybackRequestsRef.current.has(requestId) &&
      canAcceptRequestEvent(requestLifecyclesRef.current, requestId)
    ) {
      sendPlaybackAck(requestId, sequence);
      void drainPlaybackQueue(requestId);
    }
  }

  async function playBlockedAudio(): Promise<void> {
    const blocked = blockedPlaybackRef.current;
    if (!blocked) {
      return;
    }

    try {
      setManualPlaybackRequestId(null);
      const context = getPlaybackContext();
      await context.resume();
      blockedPlaybackRef.current = null;
      if (
        ignoredPlaybackRequestsRef.current.has(blocked.requestId) ||
        context.state !== "running"
      ) {
        setManualPlaybackRequestId(blocked.requestId);
        return;
      }
      startPlaybackSegment(blocked.requestId, blocked.sequence, blocked.buffer);
    } catch {
      setManualPlaybackRequestId(blocked.requestId);
    }
  }

  /** Starts a decoded segment on the graph, wired to the same finish path. */
  function ignorePlaybackRequest(requestId: string): void {
    ignoredPlaybackRequestsRef.current.add(requestId);
    if (ignoredPlaybackRequestsRef.current.size > 400) {
      const oldest = ignoredPlaybackRequestsRef.current.values().next().value as
        | string
        | undefined;
      if (oldest) {
        ignoredPlaybackRequestsRef.current.delete(oldest);
      }
    }
    cleanupPlaybackQueue(requestId);
  }

  function cleanupPlaybackQueue(requestId: string): void {
    // A cut is permanent: silence whatever is sounding and forget the reply.
    stopActivePlayback();
    blockedPlaybackRef.current = null;
    setManualPlaybackRequestId(null);
    playbackQueuesRef.current.delete(requestId);
  }

  function cleanupAllPlayback(updateUi = true): void {
    stopActivePlayback();
    playbackQueuesRef.current.clear();
    blockedPlaybackRef.current = null;
    if (updateUi) {
      setManualPlaybackRequestId(null);
    }
  }

  function sendPlaybackAck(requestId: string, sequence: number): void {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    sendRaw(socket, {
      type: WS_EVENTS.PLAYBACK_ACK,
      requestId,
      sequence
    });
  }

  function setCurrentRequest(requestId: string): void {
    activeRequestIdRef.current = requestId;
    setActiveRequestId(requestId);
  }

  function clearCurrentRequest(requestId?: string): void {
    if (requestId && activeRequestIdRef.current !== requestId) {
      return;
    }
    activeRequestIdRef.current = null;
    setActiveRequestId(null);
  }

  function completeRequest(requestId: string): void {
    setTurnAnnouncement("Response complete");
    settleRequest(requestLifecyclesRef.current, requestId, "completed");
    settleRequestLatency(requestId, "completed");
    playbackQueuesRef.current.delete(requestId);
    clearCurrentRequest(requestId);
  }

  function cancelRequest(
    requestId: string,
    latencyStatus: Exclude<LatencyRequestStatus, "active" | "completed"> =
      "interrupted"
  ): void {
    setTurnAnnouncement(
      latencyStatus === "error" ? "Response failed" : "Response interrupted"
    );
    settleRequest(requestLifecyclesRef.current, requestId, "cancelled");
    settleRequestLatency(requestId, latencyStatus);
    ignorePlaybackRequest(requestId);

    const pttContext = pttRecordingRef.current;
    if (pttContext?.requestId === requestId && !pttContext.cancelled) {
      pttContext.cancelled = true;
      if (pttContext.recorder.state !== "inactive") {
        pttContext.recorder.stop();
      }
      cleanupPushToTalkRecording(pttContext);
    }

    const liveTurn = livePcmTurnRef.current;
    if (liveTurn?.requestId === requestId) {
      liveTurn.cancelled = true;
      livePcmTurnRef.current = null;
      speechDetectorRef.current?.cancelTurn(performance.now());
      clearPreRoll();
      setRecording(false);
    recordingRef.current = false;
    }

    clearCurrentRequest(requestId);
  }

  function cancelRequestsAfterDisconnect(): void {
    for (const requestId of cancelActiveRequests(requestLifecyclesRef.current)) {
      ignorePlaybackRequest(requestId);
      settleRequestLatency(requestId, "interrupted");
    }
    cleanupAllPlayback();
    cancelPushToTalkRecording(false);
    cleanupLiveMode(false);
    activeRequestIdRef.current = null;
    setActiveRequestId(null);
    setRecording(false);
    recordingRef.current = false;
    setRecordingStatus(null);
  }

  function beginRequestLatency(
    requestId: string,
    kind: LatencyRequestKind,
    now = performance.now()
  ): void {
    setLatencySnapshot(
      beginLatencyRequest(latencyRegistryRef.current, requestId, kind, now)
    );
  }

  function markRequestLatency(
    requestId: string,
    mark: Parameters<typeof markLatency>[2],
    now = performance.now()
  ): void {
    const snapshot = markLatency(
      latencyRegistryRef.current,
      requestId,
      mark,
      now
    );
    if (!snapshot) return;
    setLatencySnapshot((current) =>
      !current || current.requestId === requestId ? snapshot : current
    );
  }

  function settleRequestLatency(
    requestId: string,
    status: Exclude<LatencyRequestStatus, "active">
  ): void {
    const snapshot = settleLatencyRequest(
      latencyRegistryRef.current,
      requestId,
      status
    );
    if (!snapshot) return;
    setLatencySnapshot((current) =>
      !current || current.requestId === requestId ? snapshot : current
    );
  }

  // Plot drawing utilities
  const plotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const plotAngleRef = useRef(0);
  /**
   * The phase the field is showing (M3.2), mirrored in a ref so the
   * animation frame reads it without re-subscribing to state. The field
   * takes the state's own code, so it is readable without reading a
   * label. Red is never among them — a cut is carried by the permanent
   * strike in the index.
   */
  const plotPhaseRef = useRef<keyof typeof PLOT_TRACE_COLORS>("idle");
  /**
   * The smoothed spectrum the field draws: one bar per step around the
   * ring. Bars peak-hold and decay, so speech rises fast and falls
   * smoothly instead of stuttering bin by bin.
   */
  const plotSpectrumRef = useRef<Float32Array | null>(null);
  /** The overall amplitude the core lamp breathes with. */
  const plotLevelRef = useRef(0);
  /**
   * Whether a real signal is feeding the field right now. With no signal the
   * field is still: no sweep turns and no bars are drawn, so idle and thinking
   * cost no motion at all.
   */
  const plotHasSignalRef = useRef(false);
  /**
   * Whether the loop is animating: true with a signal, and briefly true after
   * one leaves, so the bars decay to the ring instead of vanishing.
   */
  const plotActiveRef = useRef(false);
  /** Wakes the draw loop when a signal arrives while the field is resting. */
  const wakePlotRef = useRef<(() => void) | null>(null);
  const prefersReducedMotion = useMatchMedia('(prefers-reduced-motion: reduce)');

  // Custom hook for media query
  function useMatchMedia(query: string): boolean {
    const [matches, setMatches] = useState(() => {
      if (typeof window === 'undefined') return false;
      return window.matchMedia(query).matches;
    });

    useEffect(() => {
      const mediaQuery = window.matchMedia(query);
      const updateMatches = () => setMatches(mediaQuery.matches);
      mediaQuery.addEventListener('change', updateMatches);
      return () => mediaQuery.removeEventListener('change', updateMatches);
    }, [query]);

    return matches;
  }

  // Initialize canvas and run the draw loop, which rests whenever there is no
  // signal to show.
  useEffect(() => {
    const canvas = plotCanvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    // A panel resize moves the field without any window resize; the bitmap has
    // to follow its box or the CSS stretch smears it.
    const plotResizeObserver = new ResizeObserver(resizeCanvas);
    plotResizeObserver.observe(canvas);

    const drawPlot = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const active = plotActiveRef.current;
      const level = active ? plotLevelRef.current : 0;

      if (prefersReducedMotion) {
        // Reduced motion gets one still frame, then the field rests.
        drawJarvisField(
          ctx,
          canvas.width,
          canvas.height,
          plotPhaseRef.current,
          0,
          null,
          plotAngleRef.current,
          false
        );
        animationFrameRef.current = null;
        return;
      }

      // The sweep advances with the signal, not with the clock: louder speech
      // turns the field faster, so the motion encodes the sound rather than
      // decorating a constant rotation. With no signal nothing turns at all.
      if (active) {
        plotAngleRef.current += 0.005 + level * 0.035;
      }

      drawJarvisField(
        ctx,
        canvas.width,
        canvas.height,
        plotPhaseRef.current,
        level,
        active ? plotSpectrumRef.current : null,
        plotAngleRef.current,
        active
      );

      if (!active) {
        // The field has come to rest. Redraw only when a signal wakes it.
        animationFrameRef.current = null;
        return;
      }

      animationFrameRef.current = requestAnimationFrame(drawPlot);
    };

    const wake = () => {
      if (animationFrameRef.current === null) {
        animationFrameRef.current = requestAnimationFrame(drawPlot);
      }
    };

    wakePlotRef.current = wake;
    wake();

    return () => {
      wakePlotRef.current = null;
      plotResizeObserver.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [prefersReducedMotion]);

  // Drive the field from real signal only.
  //
  // Both voices are measured. While the microphone is live the bars
  // follow the spectrum tapped from the capture context; while the
  // agent is speaking they follow the spectrum tapped from the same
  // reply being sounded through the Web Audio graph. Neither reading
  // is simulated and neither is guessed: with no signal the bars fall
  // back to the ring and the core rests.
  useEffect(() => {
    const updatePlotData = () => {
      if (prefersReducedMotion) return;

      if (!plotSpectrumRef.current) {
        plotSpectrumRef.current = new Float32Array(PLOT_BAR_COUNT);
      }

      // Read through refs, never through state: this effect has no
      // dependencies by design, so a state read here would be frozen at
      // mount and push-to-talk would never light the field.
      // M1: the microphone switch gates the field exactly as it gates
      // capture — off means the field rests, because nothing is being
      // heard.
      const micLive =
        micEnabledRef.current &&
        ((liveModeRef.current && liveListeningRef.current) ||
          (recordingRef.current && !liveModeRef.current));
      const speaking = isPlaybackActive();

      let analyser: AnalyserNode | null = null;
      let frequencyBuffer: Float32Array | null = null;
      let phase: keyof typeof PLOT_TRACE_COLORS = "idle";

      if (micLive) {
        phase = "transcribing";
        analyser = micAnalyserRef.current;
        if (analyser) {
          if (
            !micFrequencyBufferRef.current ||
            micFrequencyBufferRef.current.length !== analyser.frequencyBinCount
          ) {
            micFrequencyBufferRef.current = new Float32Array(
              analyser.frequencyBinCount
            );
          }
          frequencyBuffer = micFrequencyBufferRef.current;
        }
      } else if (speaking) {
        phase = "speaking";
        const active = currentPlaybackRef.current;
        if (active) {
          if (
            !playbackFrequencyBufferRef.current ||
            playbackFrequencyBufferRef.current.length !==
              active.analyser.frequencyBinCount
          ) {
            playbackFrequencyBufferRef.current = new Float32Array(
              active.analyser.frequencyBinCount
            );
          }
          frequencyBuffer = playbackFrequencyBufferRef.current;
          analyser = active.analyser;
        }
      } else if (activeRequestIdRef.current) {
        // The model is streaming and no audio exists yet. The field
        // rests, but it already wears the code for the state on show.
        phase = "thinking";
      }

      const previousPhase = plotPhaseRef.current;
      plotPhaseRef.current = phase;

      let level = 0;
      if (analyser && frequencyBuffer) {
        analyser.getFloatFrequencyData(frequencyBuffer);
        level = foldSpectrum(frequencyBuffer, plotSpectrumRef.current);
      } else {
        // No signal: let the bars fall toward the ring instead of
        // drawing a shape that pretends something is happening.
        const spectrum = plotSpectrumRef.current;
        for (let index = 0; index < spectrum.length; index += 1) {
          spectrum[index] *= 0.9;
        }
      }
      plotLevelRef.current = level;

      // The field animates only while a real signal feeds it, and just long
      // enough after one leaves for the bars to fall. Otherwise it rests, and
      // the draw loop is woken only when something changes.
      const hasSignal = Boolean(analyser && frequencyBuffer);
      plotHasSignalRef.current = hasSignal;
      const animating = hasSignal || hasResidualSignal(plotSpectrumRef.current);
      plotActiveRef.current = animating;
      if (animating || phase !== previousPhase) {
        wakePlotRef.current?.();
      }
    };

    const intervalId = setInterval(updatePlotData, 16); // ~60fps
    return () => clearInterval(intervalId);
    // No state dependency: everything this reads is a ref, so React never
    // tears down and rebuilds the interval while live mode is running.
  }, []);

  // Both panels follow their newest line, so the latest exchange is always the
  // one on screen without the user reaching for a scrollbar. The scroll is set
  // after the DOM has grown, so it lands on the true bottom of the new content.
  useEffect(() => {
    const container = dialogueScrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const container = logScrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [logEvents]);

  // The tool channel: what the agent is doing, and whether it may. It is a
  // second socket, so when tools are off and the channel never opens, the only
  // trace is that nothing appears — which is the truth.
  useEffect(() => {
    const connection = connectToolChannel(toolsChannelUrl, {
      onStatus: (connected) => {
        if (connected && !toolChannelSeenRef.current) {
          toolChannelSeenRef.current = true;
          appendLog("system", "tool channel connected");
        }
      },
      onEvent: (event) => {
        if (event.type === "tool.call") {
          appendLog("tool", describeToolCall(event.tool, event.arguments));
          return;
        }
        if (event.type === "tool.result") {
          const exit =
            typeof event.exitCode === "number" && event.exitCode !== 0
              ? ` · exit ${event.exitCode}`
              : "";
          const duration =
            event.durationMs === undefined ? "" : ` · ${event.durationMs} ms`;
          appendLog("tool", `${event.tool} · ${event.outcome}${exit}${duration}`);
          return;
        }
        if (event.type === "tool.denied") {
          appendLog("gate", `denied · ${event.reason}`);
          setPendingGate((current) =>
            current && current.toolCallId === event.toolCallId ? null : current
          );
          return;
        }
        if (event.type === "gate.request") {
          appendLog("gate", `approval required · ${event.tool}`);
          setPendingGate(event);
        }
      }
    });

    toolChannelRef.current = connection;
    return () => {
      connection.close();
      toolChannelRef.current = null;
    };
    // Connect once for the life of the page: the URL is build-time constant.
  }, []);

  // Catalog state: numbered turns, the current entry, and the one color the
  // world codes each phase with. Red is reserved for a cut and never used for
  // anything else.
  const turns = buildCatalogTurns(messages);
  const currentTurn =
    turns.find((turn) => turn.requestId === activeRequestId) ??
    turns[turns.length - 1] ??
    null;
  const listening =
    (liveModeRef.current && liveListeningRef.current) ||
    (recording && !liveMode);
  const speaking = isPlaybackActive();
  const phase = listening
    ? "transcribing"
    : speaking
      ? "speaking"
      : activeRequestId
        ? "thinking"
        : "idle";

  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1>Open Voice</h1>
          <p>Live voice, streaming transcripts, and barge-in over WebSocket</p>
        </div>
        <div className={connected ? "status connected" : "status"}>
          {connectionStatus === "connected"
            ? "Connected"
            : connectionStatus === "reconnecting"
              ? "Reconnecting"
              : connectionStatus === "connecting"
                ? "Connecting"
                : "Disconnected"}
        </div>
      </header>

      <section className="meta">
        <span>Gateway: {gatewayUrl}</span>
        <span>Session: {sessionId ?? "pending"}</span>
        {!connected ? (
          <button
            className="secondary"
            type="button"
            onClick={() => reconnectNowRef.current?.()}
          >
            Reconnect now
          </button>
        ) : null}
      </section>

      <main className="main">
        {/* Left column - navigation (list of turn numbers) */}
        <nav className="nav" aria-label="Conversation history">
          <h2>Turns</h2>
          {turns.length === 0 ? (
            <p className="nav-empty">No entries yet.</p>
          ) : (
            <ul>
              {turns.map((turn) => {
                const isCurrent = turn.requestId === activeRequestId;
                return (
                  <li key={turn.requestId}>
                    <button
                      aria-label={`Turn ${turn.fac}, ${
                        turn.spoken || "no words captured"
                      }`}
                      aria-current={isCurrent ? "true" : undefined}
                      className={[
                        isCurrent ? "active" : "",
                        turn.interrupted ? "struck" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className="nav-fac">
                        {String(turn.fac).padStart(3, "0")}
                      </span>
                      <span className="nav-preview">
                        {turn.replied || turn.spoken || "…"}
                      </span>
                      {turn.interrupted ? (
                        <span className="visually-hidden">interrupted</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Center column - what the conversation is made of: the words on both
            sides, and the pipeline that produced the reply. */}
        <div className="content">
          <section className="panel dialogue" aria-label="Dialogue">
            <div className="panel-heading">
              <strong>Dialogue</strong>
              <span>
                {turns.length === 0 ? "empty" : `${turns.length} turns`}
              </span>
            </div>
            <div className="panel-body" ref={dialogueScrollRef}>
              {messages.length === 0 ? (
                <p className="panel-empty">
                  Type a message, hold to talk, or turn on Live mode.
                </p>
              ) : (
                messages.map((message) => (
                  <article
                    className={[
                      "dialogue-entry",
                      message.role,
                      message.transient ? "transient" : "",
                      message.requestId === activeRequestId ? "current" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={message.id}
                  >
                    <header className="dialogue-role">
                      {message.role === "user" ? "You" : "Assistant"}
                      {message.source === "audio" ? (
                        <span className="dialogue-source">mic</span>
                      ) : null}
                    </header>
                    {message.content ? (
                      <p className="dialogue-text">{message.content}</p>
                    ) : (
                      <>
                        <p className="dialogue-text pending" aria-hidden="true">
                          …
                        </p>
                        <span className="visually-hidden">responding</span>
                      </>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel activity" aria-label="LLM activity log">
            <div className="panel-heading">
              <strong>LLM activity</strong>
              <span>
                {logEvents.length === 0 ? "idle" : `${logEvents.length} events`}
              </span>
            </div>
            <div className="panel-body" ref={logScrollRef}>
              {logEvents.length === 0 ? (
                <p className="panel-empty">Nothing logged yet.</p>
              ) : (
                <ol className="log-list">
                  {logEvents.map((event) => (
                    <li className={`log-row ${event.kind}`} key={event.id}>
                      <time className="log-time">{formatClock(event.at)}</time>
                      <span className="log-kind">{LOG_LABELS[event.kind]}</span>
                      <span className="log-text">{event.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        {/* Right rail - the agent's presence, its current entry readout, and the
            measurements. It rides beside the conversation, not above it. */}
        <aside className="jarvis">
          <section
            className="plot-container"
            aria-label="Agent presence visualization"
          >
            <canvas
              className="plot-canvas"
              ref={plotCanvasRef}
              width="800"
              height="600"
              aria-hidden="true"
            />
          </section>

          <div className="jarvis-side">
            {/* Current entry readout */}
            <div className="entry-readout">
              {/* Entry number - the world's only headline */}
              <div className="entry-number">
                {currentTurn ? String(currentTurn.fac).padStart(3, "0") : "—"}
              </div>

              {/* Color-code strip: exactly one color per phase, red reserved for a cut */}
              <div
                className="entry-color-strip"
                data-phase={phase}
                style={{
                  backgroundColor: `var(--color-${phase})`
                }}
              />
              <span className="visually-hidden" role="status">
                {phase === "idle"
                  ? "Idle"
                  : phase === "transcribing"
                    ? "Listening"
                    : phase === "thinking"
                      ? "Thinking"
                      : "Speaking"}
              </span>

              {/* Language mark: which voice is answering, derived from its words */}
              <div className="entry-language">
                {currentTurn?.language ?? "··"}
              </div>

              {/* Turn timings as tabular numbers */}
              <div className="entry-timings">
                <div>
                  <div>STT</div>
                  <div>{latencySnapshot?.sttFirstPartialMs ?? '—'} ms</div>
                </div>
                <div>
                  <div>LLM</div>
                  <div>{latencySnapshot?.llmFirstDeltaMs ?? '—'} ms</div>
                </div>
                <div>
                  <div>TTS</div>
                  <div>{latencySnapshot?.ttsFirstAudioMs ?? '—'} ms</div>
                </div>
                <div>
                  <div>Total</div>
                  <div>{latencySnapshot?.speechEndToFirstAudioMs ?? '—'} ms</div>
                </div>
              </div>
            </div>

            {/* Instrumentation - quiet line inside the rail */}
            <div className="instrumentation">
              <section className="latencyPanel" aria-label="Voice latency metrics">
                <div className="latencyHeading">
                  <strong>Latency</strong>
                  <span>
                    {latencySnapshot
                      ? `${latencySnapshot.kind.toUpperCase()} · ${latencySnapshot.status}`
                      : "waiting for a request"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>STT first partial</dt>
                    <dd>{latencySnapshot?.sttFirstPartialMs === undefined ? "—" : `${latencySnapshot.sttFirstPartialMs} ms`}</dd>
                  </div>
                  <div>
                    <dt>Final transcript</dt>
                    <dd>{latencySnapshot?.sttFinalMs === undefined ? "—" : `${latencySnapshot.sttFinalMs} ms`}</dd>
                  </div>
                  <div>
                    <dt>LLM first token</dt>
                    <dd>{latencySnapshot?.llmFirstDeltaMs === undefined ? "—" : `${latencySnapshot.llmFirstDeltaMs} ms`}</dd>
                  </div>
                  <div>
                    <dt>TTS first audio</dt>
                    <dd>{latencySnapshot?.ttsFirstAudioMs === undefined ? "—" : `${latencySnapshot.ttsFirstAudioMs} ms`}</dd>
                  </div>
                  <div>
                    <dt>Speech end → audio</dt>
                    <dd>{latencySnapshot?.speechEndToFirstAudioMs === undefined ? "—" : `${latencySnapshot.speechEndToFirstAudioMs} ms`}</dd>
                  </div>
                </dl>
              </section>

              <section className="vadPanel" aria-label="Voice activity detector status">
                <div className="vadHeading">
                  <strong>Voice activity</strong>
                  <span>
                    {!liveModeRef.current
                      ? "off"
                      : vadSnapshot?.state === "calibrating"
                        ? `calibrating ${Math.round(vadSnapshot?.calibrationProgress ?? 0) * 100}%`
                        : (vadSnapshot?.state ?? "starting")}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>State</dt>
                    <dd>
                      {!liveModeRef.current
                        ? "off"
                        : vadSnapshot?.state === "calibrating"
                          ? `calibrating ${Math.round(vadSnapshot?.calibrationProgress ?? 0) * 100}%`
                          : (vadSnapshot?.state ?? "starting")}
                    </dd>
                  </div>
                  <div>
                    <dt>RMS</dt>
                    <dd>{formatVadLevel(vadSnapshot?.rms ?? undefined)}</dd>
                  </div>
                  <div>
                    <dt>Noise floor</dt>
                    <dd>{formatVadLevel(vadSnapshot?.noiseFloor ?? undefined)}</dd>
                  </div>
                  <div>
                    <dt>Speech / silence</dt>
                    <dd>
                      {formatVadLevel(vadSnapshot?.speechThreshold ?? undefined)} / {formatVadLevel(vadSnapshot?.silenceThreshold ?? undefined)}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </div>
        </aside>
      </main>

      {/* The turn lifecycle is announced here instead of being streamed into
          the dialogue, which would flood a screen reader token by token. */}
      <span className="visually-hidden" role="status">
        {turnAnnouncement}
      </span>

      {/* The approval gate. It sits above the composer, in the same column the
          conversation is in, and it shows the exact thing being approved —
          never a summary of it. Deny holds the focus, because the safe answer
          is the one a stray Enter should pick. */}
      {pendingGate ? (
        <section
          className="gate-panel"
          role="alertdialog"
          aria-label="Approval required"
        >
          <div className="gate-head">
            <strong>Approval required</strong>
            <span>{pendingGate.reason}</span>
          </div>
          <pre className="gate-action">{describeGateAction(pendingGate.arguments)}</pre>
          <div className="gate-actions">
            <button
              className="secondary"
              type="button"
              autoFocus
              onClick={() => answerGate("deny")}
            >
              Deny
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => answerGate("approve")}
            >
              Approve {pendingGate.tool}
            </button>
          </div>
        </section>
      ) : null}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
      >
        <input
          aria-label="Message"
          placeholder="Type a message"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={!canSend}>
          Send
        </button>
        <button
          className={liveMode ? "live-on" : "secondary"}
          type="button"
          disabled={!connected || (!liveMode && (recording || Boolean(activeRequestId)))}
          onClick={() => {
            void toggleLiveMode();
          }}
        >
          {liveMode ? "Live on" : "Live experimental"}
        </button>
        <button
          className={recording ? "recording" : "secondary"}
          type="button"
          disabled={
            liveMode || !connected || (Boolean(activeRequestId) && !recording)
          }
          onPointerDown={(event) => {
            event.preventDefault();
            void startRecording();
          }}
          onPointerUp={(event) => {
            event.preventDefault();
            stopRecording();
          }}
          onPointerCancel={stopRecording}
          onPointerLeave={() => {
            stopRecording();
          }}
          onKeyDown={(event) => {
            if (
              (event.key === "Enter" || event.key === " ") &&
              !event.repeat
            ) {
              event.preventDefault();
              void startRecording();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              stopRecording();
            }
          }}
          onBlur={stopRecording}
        >
          {recording && !liveMode ? "Release" : "Hold to Talk"}
        </button>
        <button
          className={micEnabled ? "mic-on" : "secondary"}
          type="button"
          role="switch"
          aria-checked={micEnabled}
          onClick={toggleMicEnabled}
        >
          Mic {micEnabled ? "on" : "off"}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!activeRequestId}
          onClick={stopResponse}
        >
          Stop
        </button>
      </form>

      {/* Notices and errors */}
      {recordingStatus ? (
        <p className="notice" role="status">
          {recordingStatus}
        </p>
      ) : null}
      {manualPlaybackRequestId ? (
        <>
          <p className="notice">
            The browser held the reply's audio under its autoplay policy. Click
            play to hear it.
          </p>
          <button className="playbackButton" type="button" onClick={playBlockedAudio}>
            Play audio response
          </button>
        </>
      ) : null}
      {micError ? <p className="error">{micError}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {/* Original messages area - hidden per CSS */}
      
    </main>
  );
}

function formatVadLevel(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(4);
}

/** Keeps the activity log to its newest entries. */
function trimLog(entries: LogEvent[]): LogEvent[] {
  return entries.length > MAX_LOG_EVENTS
    ? entries.slice(entries.length - MAX_LOG_EVENTS)
    : entries;
}

/** A wall-clock stamp for a log line, zero-padded and locale-independent. */
function formatClock(at: number): string {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

/**
 * Whether the bars still carry visible energy after a signal has left. The
 * field keeps animating while this is true so the spectrum falls to the ring
 * instead of vanishing, then comes to rest.
 */
function hasResidualSignal(bars: Float32Array | null): boolean {
  if (!bars) return false;
  for (let index = 0; index < bars.length; index += 1) {
    if (bars[index] > 0.02) {
      return true;
    }
  }
  return false;
}

function sendRaw(socket: WebSocket, message: ClientMessage): boolean {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function selectAudioMimeType(): string {
  const preferred = ["audio/webm;codecs=opus", "audio/webm"];
  return preferred.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return uint8ArrayToBase64(bytes);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function calculatePcm16Rms(samples: Int16Array): number {
  let sumSquares = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const normalized = samples[index] / 0x8000;
    sumSquares += normalized * normalized;
  }

  return samples.length === 0 ? 0 : Math.sqrt(sumSquares / samples.length);
}

/**
 * The Jarvis field: a radar sweep over a radial spectrum.
 *
 * The bars carry the real signal — the microphone's while the user speaks, the
 * agent's own voice while it answers — and the core breathes with the same
 * amplitude. The field is still until a signal feeds it: with `active` false it
 * draws only the guide rings and a resting core, so idle and thinking carry no
 * motion at all.
 *
 * Colour is the world's code, not decoration: each phase owns its own colour on
 * the sweep, the core and the guide rings. Only the speaking phase lets the hue
 * drift across the ring — the agent's voice is the field's brightest, most
 * colourful moment. Red is never drawn: a cut is permanent and lives in the
 * index as a strike.
 */
function drawJarvisField(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: keyof typeof PLOT_TRACE_COLORS,
  level: number,
  spectrum: Float32Array | null,
  sweepAngle: number,
  active: boolean
): void {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(centerX, centerY) * 0.94;
  const innerRadius = maxRadius * 0.3;
  const phaseColor = PLOT_TRACE_COLORS[phase];

  ctx.clearRect(0, 0, width, height);

  // Guide rings: the field's frame, kept quiet so the spectrum owns the eye.
  ctx.strokeStyle = "hsl(0, 0%, 80%)";
  ctx.globalAlpha = 0.1;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // At rest the field is a still mark: no sweep turns and no bar is drawn.
  if (!active) {
    ctx.fillStyle = phaseColor;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(2, innerRadius * 0.12), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  // Radar sweep: a trailing wedge and a leading edge.
  const trailSlices = 22;
  const trailSpan = Math.PI * 0.85;
  for (let slice = trailSlices; slice > 0; slice -= 1) {
    const sliceStart = sweepAngle - (slice / trailSlices) * trailSpan;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(
      centerX,
      centerY,
      maxRadius,
      sliceStart,
      sliceStart + trailSpan / trailSlices
    );
    ctx.closePath();
    ctx.globalAlpha = 0.045 * (1 - slice / trailSlices);
    ctx.fillStyle = phaseColor;
    ctx.fill();
  }
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(
    centerX + Math.cos(sweepAngle) * maxRadius,
    centerY + Math.sin(sweepAngle) * maxRadius
  );
  ctx.strokeStyle = phaseColor;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The spectrum: one bar per step around the ring, growing outward
  // with the signal it measures.
  if (spectrum) {
    const barCount = spectrum.length;
    const chord = (Math.PI * 2 * innerRadius) / barCount;
    ctx.lineCap = "round";
    for (let index = 0; index < barCount; index += 1) {
      const magnitude = spectrum[index];
      if (magnitude <= 0.012) {
        continue;
      }
      const angle = (index / barCount) * Math.PI * 2 - Math.PI / 2;
      const outerRadius =
        innerRadius + magnitude * (maxRadius - innerRadius);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let color: string;
      if (phase === "speaking") {
        // A band of colour drifting with the sweep.
        const hue = (index * 3.5 + sweepAngle * 24) % 360;
        color = `hsl(${hue}, 72%, ${50 + magnitude * 12}%)`;
      } else if (phase === "transcribing") {
        color = `hsl(210, 78%, ${42 + magnitude * 20}%)`;
      } else if (phase === "thinking") {
        color = `hsl(48, 82%, ${44 + magnitude * 16}%)`;
      } else {
        color = `hsl(210, 12%, ${38 + magnitude * 16}%)`;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, chord * 0.36);
      ctx.shadowColor = color;
      ctx.shadowBlur = 5 + magnitude * 9;
      ctx.beginPath();
      ctx.moveTo(centerX + cos * innerRadius, centerY + sin * innerRadius);
      ctx.lineTo(centerX + cos * outerRadius, centerY + sin * outerRadius);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // The core: a lamp that breathes with the same amplitude the bars
  // measure, so the centre of the field carries the level too.
  const coreRadius = Math.max(1.5, innerRadius * (0.3 + level * 0.5));
  ctx.shadowColor = phaseColor;
  ctx.shadowBlur = 18;
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = phaseColor;
  ctx.beginPath();
  ctx.arc(centerX, centerY, coreRadius * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

/**
 * Folds an analyser's dB spectrum into the field's fixed bar count
 * and returns the overall level. Each bar takes the bin a log-ish
 * spread lands on — more resolution where the voice lives — and
 * peak-holds with a decay, so speech rises fast and falls smoothly.
 */
function foldSpectrum(
  frequencyData: Float32Array,
  bars: Float32Array
): number {
  const usableBins = Math.floor(frequencyData.length * 0.72);
  let sum = 0;

  for (let index = 0; index < bars.length; index += 1) {
    const bin = Math.floor(
      Math.pow(index / bars.length, 1.5) * usableBins
    );
    const decibels =
      frequencyData[Math.min(bin, frequencyData.length - 1)];
    const target = Math.max(0, Math.min(1, (decibels + 85) / 60));
    const next = target > bars[index] ? target : bars[index] * 0.88;
    bars[index] = next;
    sum += next;
  }

  return Math.min(1, (sum / bars.length) * 2.4);
}
