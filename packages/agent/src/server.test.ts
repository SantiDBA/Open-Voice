import assert from "node:assert/strict";
import { test } from "vitest";

import { DEFAULT_SYSTEM_PROMPT } from "./prompt.js";
import { AGENT_VERSION, startAgent } from "./server.js";
import type { GatewayServerOptions } from "./gateway-internals.js";

const selfHostedEnv = {
  LLM_BASE_URL: "http://127.0.0.1:20128/v1",
  LLM_MODEL: "auto/best-chat",
  STT_BASE_URL: "http://speaches:8000/v1",
  TTS_BASE_URL: "http://speaches:8000/v1",
  TTS_VOICE: "af_heart",
  TTS_FORMAT: "wav",
  TTS_ENABLED: "true",
  GATEWAY_HOST: "127.0.0.1",
  GATEWAY_PORT: "8787",
  LOG_LEVEL: "debug"
} satisfies NodeJS.ProcessEnv;

interface Harness {
  options: GatewayServerOptions[];
  closed: number;
  loadEnvironmentCalls: number;
}

function createHarness(): Harness {
  return { options: [], closed: 0, loadEnvironmentCalls: 0 };
}

async function startWithHarness(
  harness: Harness,
  env: NodeJS.ProcessEnv = selfHostedEnv
) {
  const agent = await startAgent({
    env,
    loadEnvironment: () => {
      harness.loadEnvironmentCalls += 1;
    },
    createServer: async (options) => {
      harness.options.push(options);
      options.logger?.info("gateway.ready");
      return {
        webSocketServer: {} as never,
        httpServer: {} as never,
        port: options.port ?? 0,
        close: async () => {
          harness.closed += 1;
        }
      };
    },
    registerSignalHandlers: false
  });
  return agent;
}

test("startAgent loads the environment before parsing configuration", async () => {
  const harness = createHarness();
  await startWithHarness(harness);

  assert.equal(harness.loadEnvironmentCalls, 1);
});

test("startAgent passes the agent transport surface to the vendored gateway", async () => {
  const harness = createHarness();
  await startWithHarness(harness);

  assert.equal(harness.options.length, 1);
  const options = harness.options[0];
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, 8787);
  assert.deepEqual(options.allowedOrigins, []);
  assert.equal(options.ttsFormat, "wav");
  assert.equal(options.ttsVoice, "af_heart");
  assert.deepEqual(options.healthDetails, {
    version: AGENT_VERSION,
    realtimeStt: false,
    tts: true
  });
});

test("startAgent injects the four provider implementations", async () => {
  const harness = createHarness();
  const agent = await startWithHarness(harness);
  const providers = harness.options[0].providers;

  assert.equal(typeof providers.llm.streamText, "function");
  assert.equal(typeof providers.stt.transcribe, "function");
  assert.equal(typeof providers.tts?.synthesize, "function");
  assert.equal(providers.streamingStt, undefined);
  assert.equal(agent.config.tts.enabled, true);
});

test("startAgent omits the TTS provider when TTS is disabled", async () => {
  const harness = createHarness();
  await startWithHarness(harness, {
    LLM_BASE_URL: "http://127.0.0.1:20128/v1",
    STT_BASE_URL: "http://speaches:8000/v1",
    TTS_ENABLED: "false"
  });

  assert.equal("tts" in harness.options[0].providers, false);
  assert.equal(harness.options[0].ttsVoice, undefined);
});

test("startAgent passes the default system prompt to the gateway", async () => {
  const harness = createHarness();
  const agent = await startWithHarness(harness);

  assert.equal(harness.options[0].systemPrompt, DEFAULT_SYSTEM_PROMPT);
  assert.equal(agent.systemPrompt, DEFAULT_SYSTEM_PROMPT);
});

test("startAgent fails loudly when the prompt file is missing even though an inline prompt exists", async () => {
  const harness = createHarness();

  await assert.rejects(
    () =>
      startWithHarness(harness, {
        ...selfHostedEnv,
        AGENT_SYSTEM_PROMPT: "inline persona",
        AGENT_SYSTEM_PROMPT_FILE: "/missing/open-voice-prompt.txt"
      }),
    /AGENT_SYSTEM_PROMPT_FILE is not readable: \/missing\/open-voice-prompt\.txt/
  );
  assert.equal(harness.options.length, 0);
});

test("startAgent fails before creating the gateway when the prompt file is unreadable", async () => {
  const harness = createHarness();

  await assert.rejects(
    () =>
      startWithHarness(harness, {
        ...selfHostedEnv,
        AGENT_SYSTEM_PROMPT: "inline persona",
        AGENT_SYSTEM_PROMPT_FILE: "/missing/open-voice-prompt.txt"
      }),
    /AGENT_SYSTEM_PROMPT_FILE is not readable: \/missing\/open-voice-prompt\.txt/
  );
  assert.equal(harness.options.length, 0);
});

test("startAgent uses the inline prompt when no prompt file is configured", async () => {
  const harness = createHarness();
  const agent = await startWithHarness(harness, {
    ...selfHostedEnv,
    AGENT_SYSTEM_PROMPT: "  Speak plainly.  "
  });

  assert.equal(agent.systemPrompt, "Speak plainly.");
  assert.equal(harness.options[0].systemPrompt, "Speak plainly.");
});

test("startAgent logs the gateway start with host, port and health URL", async () => {
  const harness = createHarness();
  const agent = await startWithHarness(harness);

  const captured: Array<Record<string, unknown>> = [];
  const originalLog = console.log;
  console.log = (line: string): void => {
    captured.push(JSON.parse(line) as Record<string, unknown>);
  };
  try {
    agent.logger.info("agent.started", {
      host: "127.0.0.1",
      port: agent.gateway.port,
      health: `http://127.0.0.1:${agent.gateway.port}/healthz`
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(captured.length, 1);
  assert.equal(captured[0].event, "agent.started");
  assert.equal(captured[0].host, "127.0.0.1");
  assert.equal(captured[0].port, 8787);
  assert.equal(captured[0].health, "http://127.0.0.1:8787/healthz");
});

test("stopping the agent closes the gateway once and is idempotent", async () => {
  const harness = createHarness();
  const agent = await startWithHarness(harness);

  await agent.stop("SIGTERM");
  await agent.stop("SIGINT");

  assert.equal(harness.closed, 1);
});

test("stopping the agent logs the stopping and stopped events", async () => {
  const harness = createHarness();
  const agent = await startWithHarness(harness);
  const captured: Array<Record<string, unknown>> = [];
  const originalLog = console.log;
  console.log = (line: string): void => {
    captured.push(JSON.parse(line) as Record<string, unknown>);
  };
  try {
    await agent.stop("SIGTERM");
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(
    captured.map((entry) => entry.event),
    ["agent.stopping", "agent.stopped"]
  );
  assert.equal(captured[0].signal, "SIGTERM");
});

test("startAgent fails fast on an invalid agent configuration", async () => {
  const harness = createHarness();

  await assert.rejects(
    () => startWithHarness(harness, { ...selfHostedEnv, GATEWAY_PORT: "70000" }),
    /GATEWAY_PORT must be an integer between 0 and 65535/
  );
  assert.equal(harness.options.length, 0);
  assert.equal(harness.loadEnvironmentCalls, 1);
});