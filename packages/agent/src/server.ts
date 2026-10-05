import type {
  StreamingSTTWebSocket,
  StreamingSTTWebSocketFactory,
  StreamingSTTWebSocketFactoryOptions
} from "@open-gpt-live/adapters";
import { WebSocket } from "ws";

import { loadAgentConfig, type AgentConfig } from "./config.js";
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

export interface AgentRuntimeDependencies {
  env?: NodeJS.ProcessEnv;
  loadEnvironment?: () => void;
  createServer?: typeof createGatewayServer;
  createProviders?: typeof createAgentProviders;
  webSocketFactory?: StreamingSTTWebSocketFactory;
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

function nodeWebSocketFactory(
  url: string,
  options: StreamingSTTWebSocketFactoryOptions
): StreamingSTTWebSocket {
  return new WebSocket(url, { headers: options.headers });
}