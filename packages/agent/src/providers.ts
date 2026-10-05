import {
  OpenAILLMProvider,
  OpenAIRealtimeSTTProvider,
  OpenAITTSProvider,
  OpenAIWhisperProvider,
  type StreamingSTTWebSocketFactory
} from "@open-gpt-live/adapters";

import type { AgentConfig } from "./config.js";
import type { GatewayProviders } from "./gateway-internals.js";

export type { StreamingSTTWebSocketFactory };

/**
 * Builds the gateway provider set from the agent configuration.
 *
 * Every adapter receives an explicit base URL, model and API key so that the
 * upstream `OPENAI_*` environment variables are never consulted. The realtime
 * WebSocket factory is a parameter so unit tests never open a socket.
 */
export function createGatewayProviders(
  config: AgentConfig,
  webSocketFactory?: StreamingSTTWebSocketFactory
): GatewayProviders {
  const llm = new OpenAILLMProvider({
    baseUrl: config.llm.baseUrl,
    ...(config.llm.apiKey ? { apiKey: config.llm.apiKey } : {}),
    model: config.llm.model
  });

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

/** Builds the gateway provider set including TTS, when TTS is enabled. */
export function createAgentProviders(
  config: AgentConfig,
  webSocketFactory?: StreamingSTTWebSocketFactory
): GatewayProviders {
  const providers = createGatewayProviders(config, webSocketFactory);
  if (!config.tts.enabled) {
    return providers;
  }

  const tts = new OpenAITTSProvider({
    baseUrl: config.tts.baseUrl,
    ...(config.tts.apiKey ? { apiKey: config.tts.apiKey } : {}),
    model: config.tts.model,
    ...(config.tts.voice ? { voice: config.tts.voice } : {}),
    format: config.tts.format
  });

  return { ...providers, tts };
}