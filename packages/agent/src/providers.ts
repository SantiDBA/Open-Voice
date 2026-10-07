import {
  OpenAILLMProvider,
  type LLMProvider,
  type TTSProvider,
  OpenAIRealtimeSTTProvider,
  OpenAITTSProvider,
  OpenAIWhisperProvider,
  type StreamingSTTWebSocketFactory
} from "@open-gpt-live/adapters";

import type { AgentConfig } from "./config.js";
import type { GatewayProviders } from "./gateway-internals.js";
import type { AuditSink } from "./tools/audit.js";
import { createHostClient } from "./tools/host-client.js";
import { ToolLoopLlmProvider } from "./tools/llm.js";
import { NOOP_REPORTER, type ToolReporter } from "./tools/reporter.js";
import { createSandboxClient } from "./tools/sandbox-client.js";
import { LocalizedVoiceTTSProvider } from "./voice.js";

export type { StreamingSTTWebSocketFactory };

/** Used when tools are enabled but no logger was injected (tests). */
const SILENT_AUDIT: AuditSink = { info: () => undefined };

/**
 * Builds the gateway provider set from the agent configuration.
 *
 * Every adapter receives an explicit base URL, model and API key so that the
 * upstream `OPENAI_*` environment variables are never consulted. The realtime
 * WebSocket factory is a parameter so unit tests never open a socket.
 */
export function createGatewayProviders(
  config: AgentConfig,
  webSocketFactory?: StreamingSTTWebSocketFactory,
  logger?: AuditSink,
  reporter?: ToolReporter
): GatewayProviders {
  const llm = createLlmProvider(config, logger, reporter);

  const stt = new OpenAIWhisperProvider({
    baseUrl: config.stt.baseUrl,
    ...(config.stt.apiKey ? { apiKey: config.stt.apiKey } : {}),
    model: config.stt.model
  });

  if (!config.stt.realtimeEnabled || webSocketFactory === undefined) {
    return { llm, stt };
  }

  const streamingStt = new OpenAIRealtimeSTTProvider({
    webSocketFactory,
    ...(config.stt.realtimeApiKey
      ? { apiKey: config.stt.realtimeApiKey }
      : {}),
    model: config.stt.model
  });

  return { llm, stt, streamingStt };
}

/**
 * The LLM provider the agent hands to the gateway.
 *
 * With tools off this is exactly the vendored provider, so the agent is the
 * speaking assistant it has always been. With tools on it is the agent's own
 * loop: the gateway still sees one `streamText` call, and never learns that the
 * turn involved running commands or reading files.
 */
function createLlmProvider(
  config: AgentConfig,
  logger?: AuditSink,
  reporter?: ToolReporter
): LLMProvider {
  if (!config.tools.enabled) {
    return new OpenAILLMProvider({
      baseUrl: config.llm.baseUrl,
      ...(config.llm.apiKey ? { apiKey: config.llm.apiKey } : {}),
      model: config.llm.model
    });
  }

  return new ToolLoopLlmProvider({
    baseUrl: config.llm.baseUrl,
    ...(config.llm.apiKey ? { apiKey: config.llm.apiKey } : {}),
    model: config.llm.model,
    sandbox: createSandboxClient({
      baseUrl: config.tools.sandboxBaseUrl,
      ...(config.tools.sandboxToken ? { token: config.tools.sandboxToken } : {})
    }),
    // Only when an executor is configured, so the model is never offered a way
    // to reach the machine that does not exist.
    ...(config.tools.hostExecutorBaseUrl && config.tools.hostExecutorToken
      ? {
          host: createHostClient({
            baseUrl: config.tools.hostExecutorBaseUrl,
            token: config.tools.hostExecutorToken
          })
        }
      : {}),
    // In dry-run mode the host client logs a notice: actions run in the
    // container namespace, not on the machine. The flag itself is read by the
    // host executor, but the agent surfaces it in its audit trail.
    ...(config.tools.hostExecutorBaseUrl &&
      config.tools.hostExecutorDryRun
      ? { hostDryRun: true }
      : {}),
    audit: logger ?? SILENT_AUDIT,
    reporter: reporter ?? NOOP_REPORTER,
    approval: config.tools.approval,
    maxIterations: config.tools.maxIterations,
    actionTimeoutMs: config.tools.actionTimeoutMs,
    maxOutputBytes: config.tools.maxOutputBytes
  });
}

/** Spanish voice used when language routing is enabled and none is configured. */
export const DEFAULT_TTS_VOICE_ES = "ef_dora";

/** English voice used when language routing is enabled and none is configured. */
export const DEFAULT_TTS_VOICE_EN = "af_heart";

/**
 * Wraps a TTS provider so each segment is spoken by a voice that speaks its
 * language.
 *
 * Routing is opt-in: without `TTS_VOICE_EN` the provider is returned unwrapped
 * and the agent behaves exactly as before, with one fixed voice.
 */
export function createTtsProvider(config: AgentConfig): TTSProvider {
  const base = new OpenAITTSProvider({
    baseUrl: config.tts.baseUrl,
    ...(config.tts.apiKey ? { apiKey: config.tts.apiKey } : {}),
    model: config.tts.model,
    ...(config.tts.voice ? { voice: config.tts.voice } : {}),
    format: config.tts.format
  });

  if (config.tts.voiceEn === undefined) {
    return base;
  }

  return new LocalizedVoiceTTSProvider(base, {
    spanish: config.tts.voiceEs ?? DEFAULT_TTS_VOICE_ES,
    english: config.tts.voiceEn,
    ...(config.tts.voice ? { fallback: config.tts.voice } : {})
  });
}

/** Builds the gateway provider set including TTS, when TTS is enabled. */
export function createAgentProviders(
  config: AgentConfig,
  webSocketFactory?: StreamingSTTWebSocketFactory,
  logger?: AuditSink,
  reporter?: ToolReporter
): GatewayProviders {
  const providers = createGatewayProviders(config, webSocketFactory, logger, reporter);
  if (!config.tts.enabled) {
    return providers;
  }

  return { ...providers, tts: createTtsProvider(config) };
}