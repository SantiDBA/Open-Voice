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
  /** Single fixed voice. Unchanged behavior when language routing is off. */
  voice?: string;
  /** Voice for Spanish replies. Absent means language routing is disabled. */
  voiceEs?: string;
  /** Voice for English replies. Absent means language routing is disabled. */
  voiceEn?: string;
  format: string;
}

export interface PromptConfig {
  systemPrompt?: string;
  systemPromptFile?: string;
}

/**
 * Whether the agent may act, and where it acts.
 *
 * Off by default, and that default is load-bearing: with `TOOLS_ENABLED` unset
 * the agent is exactly the speaking assistant it was before, and every existing
 * behaviour and test is untouched. The only way to get the tool loop is to ask
 * for it and to supply the credential the sandbox requires.
 */
export interface ToolingConfig {
  /** Whether the agent may run tools at all. */
  enabled: boolean;
  /** Base URL of the sandbox action API. */
  sandboxBaseUrl: string;
  /** Bearer token for the sandbox action API. Required when enabled. */
  sandboxToken?: string;
  /** Most model/tool round-trips allowed in a single turn. */
  maxIterations: number;
  /** Ceiling for one action, passed through to the sandbox. */
  actionTimeoutMs: number;
  /** Ceiling for one action's output, passed through to the sandbox. */
  maxOutputBytes: number;
  /** Interface the browser channel listens on. */
  channelHost: string;
  /** Port the browser channel listens on. */
  channelPort: number;
  /**
   * What needs a human decision before it runs.
   *
   * `sandbox` — the default — runs anything confined to the sandbox on its own
   * and only asks for actions that leave it. `all` asks before every tool call,
   * which is the same choice the vendored world's neighbours offer as
   * "regular permissions" rather than sandbox auto-allow.
   */
  approval: "sandbox" | "all";
  /**
   * The host executor, when the operator has started one. Both values are
   * required together: a URL without a credential is a misconfiguration, and an
   * absent URL means the agent offers no way to reach the machine at all.
   */
  hostExecutorBaseUrl?: string;
  hostExecutorToken?: string;
  /**
   * Run host-executor actions in the container namespace instead of over SSH.
   * Defaults to true: a dry run is safe to enable without credentials, and lets
   * the operator test the allowlist and the approval flow before granting real
   * host access. Set to false only when the host executor is configured with a
   * real SSH target.
   */
  hostExecutorDryRun: boolean;
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
  tools: ToolingConfig;
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

  // Acting is opt-in, and asking for it without the credential the sandbox
  // requires is a configuration error rather than a feature that quietly does
  // nothing.
  const toolsEnabled = parseBoolean(env.TOOLS_ENABLED, false, "TOOLS_ENABLED");
  const sandboxToken = nonEmpty(env.SANDBOX_TOKEN);
  if (toolsEnabled && !sandboxToken) {
    throw new Error(
      "SANDBOX_TOKEN is required when TOOLS_ENABLED=true: the sandbox action API refuses unauthenticated callers"
    );
  }

  // Escalation is all-or-nothing: an address with no credential would be an
  // open door, so it is a configuration error rather than a warning.
  const hostExecutorBaseUrl = nonEmpty(env.HOST_EXECUTOR_BASE_URL);
  const hostExecutorToken = nonEmpty(env.HOST_EXECUTOR_TOKEN);
  if (hostExecutorBaseUrl && !hostExecutorToken) {
    throw new Error(
      "HOST_EXECUTOR_TOKEN is required when HOST_EXECUTOR_BASE_URL is set: the host executor refuses unauthenticated callers"
    );
  }

  // Dry-run keeps host actions inside the container until the operator is ready
  // to grant real SSH access. It defaults to ON so that simply pointing the
  // agent at a host executor does not silently hand over the machine.
  const hostExecutorDryRun = parseBoolean(
    env.HOST_EXECUTOR_DRY_RUN,
    true,
    "HOST_EXECUTOR_DRY_RUN"
  );

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
      // Defaults live in provider construction, not here: an unset variable
      // must stay distinguishable from an explicit choice.
      ...(nonEmpty(env.TTS_VOICE_ES) ? { voiceEs: nonEmpty(env.TTS_VOICE_ES) } : {}),
      ...(nonEmpty(env.TTS_VOICE_EN) ? { voiceEn: nonEmpty(env.TTS_VOICE_EN) } : {}),
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
    tools: {
      enabled: toolsEnabled,
      sandboxBaseUrl:
        nonEmpty(env.SANDBOX_BASE_URL) ?? "http://127.0.0.1:8790",
      ...(sandboxToken ? { sandboxToken } : {}),
      maxIterations: parseInteger(env.TOOLS_MAX_ITERATIONS, 12, "TOOLS_MAX_ITERATIONS", 1, 100),
      actionTimeoutMs: parseInteger(
        env.TOOLS_ACTION_TIMEOUT_MS,
        120_000,
        "TOOLS_ACTION_TIMEOUT_MS",
        1_000,
        INT32_MAX
      ),
      maxOutputBytes: parseInteger(
        env.TOOLS_MAX_OUTPUT_BYTES,
        262_144,
        "TOOLS_MAX_OUTPUT_BYTES",
        1_024,
        INT32_MAX
      ),
      channelHost: nonEmpty(env.TOOLS_HOST) ?? "127.0.0.1",
      channelPort: parseInteger(env.TOOLS_PORT, 8788, "TOOLS_PORT", 1, 65_535),
      approval:
        optionalEnum(env.TOOLS_APPROVAL, ["sandbox", "all"] as const, "TOOLS_APPROVAL") ??
        "sandbox",
      ...(hostExecutorBaseUrl ? { hostExecutorBaseUrl } : {}),
      ...(hostExecutorToken ? { hostExecutorToken } : {}),
      hostExecutorDryRun
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