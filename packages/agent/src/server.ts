import type {
  StreamingSTTWebSocket,
  StreamingSTTWebSocketFactory,
  StreamingSTTWebSocketFactoryOptions
} from "@open-gpt-live/adapters";
import { WebSocket } from "ws";

import {
  loadAgentConfig,
  type AgentConfig,
  type LlmConfig
} from "./config.js";
import {
  createGatewayServer,
  createJsonLogger,
  loadProjectEnvironment,
  type GatewayLogger,
  type GatewayServerHandle
} from "./gateway-internals.js";
import { resolveSystemPrompt } from "./prompt.js";
import { createAgentProviders } from "./providers.js";

export const AGENT_VERSION = "0.1.0";

/** How long the startup reachability probe may take before it is abandoned. */
export const LLM_PROBE_TIMEOUT_MS = 3_000;

/** Single request against the OpenAI-compatible model list of the LLM base URL. */
export interface LlmProbeRequest {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}

/** Outcome of the startup reachability probe, mirroring a `/models` response. */
export interface LlmProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export type LlmProbe = (request: LlmProbeRequest) => Promise<LlmProbeResult>;

export interface AgentRuntimeDependencies {
  env?: NodeJS.ProcessEnv;
  loadEnvironment?: () => void;
  createServer?: typeof createGatewayServer;
  createProviders?: typeof createAgentProviders;
  webSocketFactory?: StreamingSTTWebSocketFactory;
  probeLlm?: LlmProbe;
  registerSignalHandlers?: boolean;
}

export interface RunningAgent {
  gateway: GatewayServerHandle;
  logger: GatewayLogger;
  config: AgentConfig;
  systemPrompt: string;
  stop(signal: string): Promise<void>;
}

/**
 * Loads the environment, builds the provider set and starts the vendored
 * gateway with the agent's own configuration and persona.
 */
export async function startAgent(
  dependencies: AgentRuntimeDependencies = {}
): Promise<RunningAgent> {
  const env = dependencies.env ?? process.env;
  (dependencies.loadEnvironment ?? (() => loadProjectEnvironment(env)))();
  const config = loadAgentConfig(env);
  const systemPrompt = resolveSystemPrompt(config.prompt);
  const logger = createJsonLogger(config.logLevel);
  const providers = (dependencies.createProviders ?? createAgentProviders)(
    config,
    dependencies.webSocketFactory ?? nodeWebSocketFactory
  );

  const gateway = await (dependencies.createServer ?? createGatewayServer)({
    host: config.host,
    port: config.port,
    allowedOrigins: config.allowedOrigins,
    providers,
    systemPrompt,
    ttsFormat: config.tts.format,
    ...(config.tts.voice ? { ttsVoice: config.tts.voice } : {}),
    logger,
    healthDetails: {
      version: AGENT_VERSION,
      realtimeStt: config.stt.realtimeEnabled,
      tts: config.tts.enabled
    }
  });

  logger.info("agent.started", {
    host: config.host,
    port: gateway.port,
    health: `http://${config.host}:${gateway.port}/healthz`,
    llmModel: config.llm.model,
    llmBaseUrl: config.llm.baseUrl,
    sttModel: config.stt.model,
    realtimeStt: config.stt.realtimeEnabled,
    tts: config.tts.enabled
  });

  announceLlmReachability(
    config.llm,
    logger,
    dependencies.probeLlm ?? fetchLlmProbe
  );

  let shuttingDown = false;
  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("agent.stopping", { signal });
    await gateway.close();
    logger.info("agent.stopped", { signal });
  };

  if (dependencies.registerSignalHandlers ?? true) {
    process.once("SIGINT", () => void stop("SIGINT"));
    process.once("SIGTERM", () => void stop("SIGTERM"));
  }

  return { gateway, logger, config, systemPrompt, stop };
}

/**
 * Probes the LLM once after the gateway listens so an unreachable provider is
 * announced at startup instead of surfacing on a user's first turn.
 *
 * The probe is fire-and-forget: an unreachable LLM is a warning, never a fatal
 * configuration error, so startup, `/healthz` and WebSocket sessions all
 * continue and the agent recovers once the provider answers again. The catch is
 * attached to the launched promise so nothing escapes as an unhandled rejection.
 */
function announceLlmReachability(
  llm: LlmConfig,
  logger: GatewayLogger,
  probe: LlmProbe
): void {
  void (async () => {
    const url = llmProbeUrl(llm.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_PROBE_TIMEOUT_MS);
    try {
      const result = await probe({
        url,
        headers: llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {},
        signal: controller.signal
      });
      if (result.ok) {
        logger.info("agent.llm_reachable", { url });
        return;
      }
      logger.warn("agent.llm_unreachable", {
        url,
        error: result.error ?? `HTTP ${result.status ?? "unknown"}`
      });
    } catch (error) {
      logger.warn("agent.llm_unreachable", {
        url,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      clearTimeout(timer);
    }
  })().catch(() => undefined);
}

/** Matches the adapters: the provider URL is stripped of trailing slashes. */
function llmProbeUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

async function fetchLlmProbe({
  url,
  headers,
  signal
}: LlmProbeRequest): Promise<LlmProbeResult> {
  const response = await fetch(url, { method: "GET", headers, signal });
  return { ok: response.ok, status: response.status };
}

function nodeWebSocketFactory(
  url: string,
  options: StreamingSTTWebSocketFactoryOptions
): StreamingSTTWebSocket {
  return new WebSocket(url, { headers: options.headers });
}