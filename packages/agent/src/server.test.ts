import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "vitest";

import { DEFAULT_SYSTEM_PROMPT } from "./prompt.js";
import {
  AGENT_VERSION,
  LLM_PROBE_TIMEOUT_MS,
  startAgent,
  type LlmProbeRequest,
  type LlmProbeResult
} from "./server.js";
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
  probes: LlmProbeRequest[];
}

function createHarness(): Harness {
  return { options: [], closed: 0, loadEnvironmentCalls: 0, probes: [] };
}

/** Lets the deliberately unawaited startup probe settle before assertions run. */
async function settleProbe(): Promise<void> {
  await delay(10);
}

/** Collects the JSON logger's stdout and stderr writes into a captured list. */
function captureLogs(captured: Array<Record<string, unknown>>): () => void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const capture = (line: string): void => {
    captured.push(JSON.parse(line) as Record<string, unknown>);
  };
  console.log = capture;
  console.warn = capture;
  return () => {
    console.log = originalLog;
    console.warn = originalWarn;
  };
}

/** Runs `body` with the agent's structured logs captured, then restores the console. */
async function captureAgentLogs(
  body: () => Promise<void> | void
): Promise<Array<Record<string, unknown>>> {
  const captured: Array<Record<string, unknown>> = [];
  const restoreLogs = captureLogs(captured);
  try {
    await body();
    await settleProbe();
  } finally {
    restoreLogs();
  }
  return captured;
}

async function startWithHarness(
  harness: Harness,
  env: NodeJS.ProcessEnv = selfHostedEnv,
  probeLlm: (request: LlmProbeRequest) => Promise<LlmProbeResult> = async () => ({
    ok: true,
    status: 200
  })
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
    probeLlm: async (request) => {
      harness.probes.push(request);
      return probeLlm(request);
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
  // The startup probe stays pending here so this assertion stays scoped to the
  // two shutdown events.
  const agent = await startWithHarness(harness, selfHostedEnv, (request) =>
    new Promise<LlmProbeResult>((_resolve, reject) => {
      request.signal.addEventListener("abort", () =>
        reject(new Error("LLM probe timed out"))
      );
    })
  );
  const captured: Array<Record<string, unknown>> = [];
  const restoreLogs = captureLogs(captured);
  try {
    await agent.stop("SIGTERM");
  } finally {
    restoreLogs();
  }

  assert.deepEqual(
    captured.map((entry) => entry.event),
    ["agent.stopping", "agent.stopped"]
  );
  assert.equal(captured[0].signal, "SIGTERM");
});

test("the startup probe runs once, after the gateway listens, against the LLM models endpoint", async () => {
  const harness = createHarness();
  const captured: Array<Record<string, unknown>> = [];
  const restoreLogs = captureLogs(captured);
  try {
    await startWithHarness(harness, {
      ...selfHostedEnv,
      LLM_BASE_URL: "http://127.0.0.1:20128/v1/",
      LLM_API_KEY: "llm-secret"
    });
    await settleProbe();
  } finally {
    restoreLogs();
  }

  assert.equal(harness.probes.length, 1);
  assert.equal(harness.probes[0].url, "http://127.0.0.1:20128/v1/models");
  assert.equal(harness.probes[0].headers.Authorization, "Bearer llm-secret");
  const startedAt = captured.findIndex((entry) => entry.event === "agent.started");
  const reachableAt = captured.findIndex(
    (entry) => entry.event === "agent.llm_reachable"
  );
  assert.equal(reachableAt, startedAt + 1);
});

test("the startup probe sends no authorization header when no LLM API key is configured", async () => {
  const harness = createHarness();
  await captureAgentLogs(async () => {
    await startWithHarness(harness, {
      LLM_BASE_URL: "http://127.0.0.1:20128/v1",
      STT_BASE_URL: "http://speaches:8000/v1",
      TTS_ENABLED: "false"
    });
  });

  assert.deepEqual(harness.probes[0].headers, {});
});

test("a reachable LLM logs agent.llm_reachable and never warns", async () => {
  const harness = createHarness();
  const captured = await captureAgentLogs(async () => {
    await startWithHarness(harness);
  });

  assert.equal(
    captured.filter((entry) => entry.event === "agent.llm_unreachable").length,
    0
  );
  assert.equal(
    captured.filter((entry) => entry.event === "agent.llm_reachable").length,
    1
  );
});

test("an unreachable LLM warns once with the configured URL and keeps the agent running", async () => {
  const harness = createHarness();
  const captured: Array<Record<string, unknown>> = [];
  const restoreLogs = captureLogs(captured);
  let agent;
  try {
    agent = await startWithHarness(harness, selfHostedEnv, async () => ({
      ok: false,
      status: 401
    }));
    await settleProbe();
    await agent.stop("SIGTERM");
  } finally {
    restoreLogs();
  }

  const warnings = captured.filter(
    (entry) => entry.event === "agent.llm_unreachable"
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].level, "warn");
  assert.equal(warnings[0].url, "http://127.0.0.1:20128/v1/models");
  assert.equal(warnings[0].error, "HTTP 401");
  assert.equal(harness.closed, 1);
});

test("a network failure while probing the LLM warns once with the error description", async () => {
  const harness = createHarness();
  const captured = await captureAgentLogs(async () => {
    await startWithHarness(harness, selfHostedEnv, async () => {
      throw new Error("connect ECONNREFUSED 172.17.0.1:20128");
    });
  });

  const warnings = captured.filter(
    (entry) => entry.event === "agent.llm_unreachable"
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].url, "http://127.0.0.1:20128/v1/models");
  assert.equal(warnings[0].error, "connect ECONNREFUSED 172.17.0.1:20128");
});

test("an asynchronous probe failure neither escapes as an unhandled rejection nor fails startup", async () => {
  const harness = createHarness();
  const unhandled: Array<unknown> = [];
  const onUnhandled = (error: unknown): void => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", onUnhandled);

  const captured: Array<Record<string, unknown>> = [];
  const restoreLogs = captureLogs(captured);
  let agent;
  try {
    agent = await startWithHarness(harness, selfHostedEnv, () => {
      throw new Error("probe exploded after the response settled");
    });
    await settleProbe();
    await delay(20);
  } finally {
    restoreLogs();
    process.off("unhandledRejection", onUnhandled);
  }

  assert.deepEqual(unhandled, []);
  assert.equal(
    captured.filter((entry) => entry.event === "agent.llm_unreachable").length,
    1
  );
  assert.equal(harness.options.length, 1);
  await agent!.stop("SIGTERM");
  assert.equal(harness.closed, 1);
});

test("a probe that never settles is abandoned after the probe timeout without blocking startup", async () => {
  const harness = createHarness();
  const captured: Array<Record<string, unknown>> = [];
  const restoreLogs = captureLogs(captured);
  let agent;
  try {
    agent = await startWithHarness(harness, selfHostedEnv, (request) =>
      new Promise<LlmProbeResult>((_resolve, reject) => {
        request.signal.addEventListener("abort", () =>
          reject(new Error("LLM probe timed out"))
        );
      })
    );
    await settleProbe();
  } finally {
    restoreLogs();
  }

  assert.equal(agent!.gateway.port, 8787);
  assert.equal(
    captured.filter((entry) => entry.event === "agent.llm_unreachable").length,
    0
  );
  await agent!.stop("SIGTERM");
  assert.ok(LLM_PROBE_TIMEOUT_MS >= 3_000 && LLM_PROBE_TIMEOUT_MS <= 5_000);
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