import { isOpenAIHostedUrl } from "@open-gpt-live/adapters";

/** Log levels accepted by the vendored gateway JSON logger. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Upper bound used by the latency knobs, which only have a meaningful floor. */
const INT32_MAX = 2_147_483_647;

export interface LlmConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface SttConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  realtimeEnabled: boolean;
  /** Credential for the OpenAI-only Realtime STT WebSocket API. */
  realtimeApiKey?: string;
}

export interface TtsConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  model: string;
  voice?: string;
  format: string;
}

export interface PromptConfig {
  systemPrompt?: string;
  systemPromptFile?: string;
}

/**
 * Latency knobs the vendored gateway already accepts as `createGatewayServer`
 * options. Every default mirrors upstream's own hardcoded value
 * (`ttsSegmentMinLength` 24, `ttsSegmentMaxLength` 240,
 * `livePartialInitialIntervalMs` 2000, `livePartialLongTurnIntervalMs` 5000,
 * `livePartialLongTurnAfterMs` 30000), so an existing deployment behaves
 * exactly as before unless a variable is set.
 */
export interface LatencyConfig {
  /** Characters required before a streamed segment is synthesized. */
  ttsSegmentMinLength: number;
  /** Characters that force a segment to be cut and synthesized. */
  ttsSegmentMaxLength: number;
  /** Re-transcription interval for a partial transcript early in a live turn. */
  livePartialInitialIntervalMs: number;
  /** Re-transcription interval for a partial transcript in a long live turn. */
  livePartialLongTurnIntervalMs: number;
  /** Live turn duration after which the long-turn interval takes over. */
  livePartialLongTurnAfterMs: number;
}

/**
 * The agent's own configuration namespace. Upstream `OPENAI_*` variables are
 * never read: every value is resolved here and injected into the adapters.
 */
export interface AgentConfig {
  llm: LlmConfig;
  stt: SttConfig;
  tts: TtsConfig;
  prompt: PromptConfig;
  latency: LatencyConfig;
  host: string;
  port: number;
  allowedOrigins: string[];
  logLevel: LogLevel;
}

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const llmApiKey = nonEmpty(env.LLM_API_KEY);
  const llmBaseUrl =
    nonEmpty(env.LLM_BASE_URL) ?? "https://api.openai.com/v1";
  const sttApiKey = nonEmpty(env.STT_API_KEY);
  const sttBaseUrl = nonEmpty(env.STT_BASE_URL) ?? llmBaseUrl;
  const ttsApiKey = nonEmpty(env.TTS_API_KEY);
  // TTS_BASE_URL is only meaningful with TTS_ENABLED, so an unset value keeps
  // the OpenAI default and never trips the hosted-URL credential check.
  const ttsBaseUrl = nonEmpty(env.TTS_BASE_URL) ?? "https://api.openai.com/v1";
  // The OpenAI Realtime STT protocol is OpenAI-only: it authenticates with the
  // STT credential and falls back to the LLM credential.
  const realtimeSttApiKey = sttApiKey ?? llmApiKey;

  if (isOpenAIHostedUrl(llmBaseUrl) && !llmApiKey) {
    throw new Error("LLM_API_KEY is required for api.openai.com");
  }
  if (isOpenAIHostedUrl(sttBaseUrl) && !sttApiKey) {
    throw new Error(
      "STT_API_KEY is required for api.openai.com, or point STT_BASE_URL at a self-hosted provider"
    );
  }

  const ttsEnabled = parseBoolean(env.TTS_ENABLED, Boolean(ttsApiKey), "TTS_ENABLED");
  if (ttsEnabled && isOpenAIHostedUrl(ttsBaseUrl) && !ttsApiKey) {
    throw new Error(
      "TTS_API_KEY is required for api.openai.com when TTS_ENABLED=true, or set TTS_ENABLED=false"
    );
  }

  const realtimeSttEnabled = parseBoolean(
    env.STT_REALTIME_ENABLED,
    false,
    "STT_REALTIME_ENABLED"
  );
  if (realtimeSttEnabled && !realtimeSttApiKey) {
    throw new Error(
      "STT_REALTIME_ENABLED requires STT_API_KEY or LLM_API_KEY: the realtime protocol is OpenAI-only"
    );
  }

  return {
    llm: {
      baseUrl: llmBaseUrl,
      ...(llmApiKey ? { apiKey: llmApiKey } : {}),
      model: nonEmpty(env.LLM_MODEL) ?? "gpt-4o-mini"
    },
    stt: {
      baseUrl: sttBaseUrl,
      ...(sttApiKey ? { apiKey: sttApiKey } : {}),
      model: nonEmpty(env.STT_MODEL) ?? "whisper-1",
      realtimeEnabled: realtimeSttEnabled,
      // The Realtime STT provider always dials its own OpenAI-hosted WebSocket
      // URL, so it needs the OpenAI credential rather than the STT base URL.
      ...(realtimeSttEnabled && realtimeSttApiKey
        ? { realtimeApiKey: realtimeSttApiKey }
        : {})
    },
    tts: {
      enabled: ttsEnabled,
      baseUrl: ttsBaseUrl,
      ...(ttsApiKey ? { apiKey: ttsApiKey } : {}),
      model: nonEmpty(env.TTS_MODEL) ?? "tts-1",
      ...(nonEmpty(env.TTS_VOICE) ? { voice: nonEmpty(env.TTS_VOICE) } : {}),
      format: nonEmpty(env.TTS_FORMAT) ?? "mp3"
    },
    prompt: {
      ...(nonEmpty(env.AGENT_SYSTEM_PROMPT)
        ? { systemPrompt: nonEmpty(env.AGENT_SYSTEM_PROMPT) }
        : {}),
      ...(nonEmpty(env.AGENT_SYSTEM_PROMPT_FILE)
        ? { systemPromptFile: nonEmpty(env.AGENT_SYSTEM_PROMPT_FILE) }
        : {})
    },
    latency: {
      ttsSegmentMinLength: parseInteger(
        env.TTS_SEGMENT_MIN_LENGTH,
        24,
        "TTS_SEGMENT_MIN_LENGTH",
        1,
        INT32_MAX
      ),
      ttsSegmentMaxLength: parseInteger(
        env.TTS_SEGMENT_MAX_LENGTH,
        240,
        "TTS_SEGMENT_MAX_LENGTH",
        1,
        INT32_MAX
      ),
      livePartialInitialIntervalMs: parseInteger(
        env.LIVE_PARTIAL_INITIAL_INTERVAL_MS,
        2_000,
        "LIVE_PARTIAL_INITIAL_INTERVAL_MS",
        100,
        INT32_MAX
      ),
      livePartialLongTurnIntervalMs: parseInteger(
        env.LIVE_PARTIAL_LONG_TURN_INTERVAL_MS,
        5_000,
        "LIVE_PARTIAL_LONG_TURN_INTERVAL_MS",
        100,
        INT32_MAX
      ),
      livePartialLongTurnAfterMs: parseInteger(
        env.LIVE_PARTIAL_LONG_TURN_AFTER_MS,
        30_000,
        "LIVE_PARTIAL_LONG_TURN_AFTER_MS",
        0,
        INT32_MAX
      )
    },
    host: nonEmpty(env.GATEWAY_HOST) ?? "0.0.0.0",
    port: parseInteger(env.GATEWAY_PORT, 8787, "GATEWAY_PORT", 0, 65_535),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    logLevel:
      optionalEnum(env.LOG_LEVEL, LOG_LEVELS, "LOG_LEVEL") ?? "info"
  };
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number
): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string
): boolean {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be true, false, 1, or 0`);
}

function optionalEnum<const T extends readonly string[]>(
  value: string | undefined,
  choices: T,
  name: string
): T[number] | undefined {
  const normalized = nonEmpty(value);
  if (!normalized) return undefined;
  if (choices.includes(normalized)) return normalized as T[number];
  throw new Error(`${name} must be one of: ${choices.join(", ")}`);
}

function parseAllowedOrigins(value: string | undefined): string[] {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${entry}`);
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin !== entry
    ) {
      throw new Error(
        `ALLOWED_ORIGINS must contain exact http(s) origins without paths: ${entry}`
      );
    }
  }
  return entries;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}