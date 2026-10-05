import assert from "node:assert/strict";
import { test } from "vitest";

import { loadAgentConfig } from "./config.js";
import { createAgentProviders } from "./providers.js";

const selfHostedEnv = {
  LLM_BASE_URL: "http://127.0.0.1:20128/v1",
  LLM_MODEL: "auto/best-chat",
  STT_BASE_URL: "http://speaches:8000/v1",
  STT_MODEL: "Systran/faster-whisper-small",
  TTS_BASE_URL: "http://speaches:8000/v1",
  TTS_MODEL: "hexgrad/Kokoro-82M",
  TTS_ENABLED: "true"
} satisfies NodeJS.ProcessEnv;

const selfHostedConfig = loadAgentConfig(selfHostedEnv);

type AdapterInternals = Record<string, string>;

function internals(provider: unknown): AdapterInternals {
  return provider as AdapterInternals;
}

test("providers carry the agent base URL and model into every adapter", () => {
  const providers = createAgentProviders(selfHostedConfig);

  assert.equal(internals(providers.llm).baseUrl, "http://127.0.0.1:20128/v1");
  assert.equal(internals(providers.llm).model, "auto/best-chat");
  assert.equal(internals(providers.stt).baseUrl, "http://speaches:8000/v1");
  assert.equal(internals(providers.stt).model, "Systran/faster-whisper-small");
  assert.equal(internals(providers.tts).baseUrl, "http://speaches:8000/v1");
  assert.equal(internals(providers.tts).model, "hexgrad/Kokoro-82M");
  // The adapter falls back to `process.env.TTS_VOICE` when no voice is injected,
  // so only assert that a voice is present, not which one.
  assert.ok(internals(providers.tts).voice.length > 0);
  assert.equal(internals(providers.tts).format, "mp3");
});

test("providers pass explicit API keys when configured", () => {
  const config = loadAgentConfig({
    ...selfHostedEnv,
    LLM_API_KEY: "llm-key",
    STT_API_KEY: "stt-key",
    TTS_API_KEY: "tts-key"
  });
  const providers = createAgentProviders(config);

  assert.equal(internals(providers.llm).apiKey, "llm-key");
  assert.equal(internals(providers.stt).apiKey, "stt-key");
  assert.equal(internals(providers.tts).apiKey, "tts-key");
});

test("providers omit the API key for credential-free self-hosted providers", () => {
  const providers = createAgentProviders(selfHostedConfig);

  assert.equal(internals(providers.llm).apiKey, "");
  assert.equal(internals(providers.stt).apiKey, "");
  assert.equal(internals(providers.tts).apiKey, "");
});

test("providers use the configured TTS voice and format", () => {
  const config = loadAgentConfig({
    ...selfHostedEnv,
    TTS_VOICE: "af_heart",
    TTS_FORMAT: "wav"
  });
  const providers = createAgentProviders(config);

  assert.equal(internals(providers.tts).voice, "af_heart");
  assert.equal(internals(providers.tts).format, "wav");
});

test("providers omit TTS when TTS is disabled", () => {
  const config = loadAgentConfig({
    LLM_BASE_URL: "http://127.0.0.1:20128/v1",
    STT_BASE_URL: "http://speaches:8000/v1",
    TTS_ENABLED: "false"
  });

  assert.equal(config.tts.enabled, false);
  assert.equal("tts" in createAgentProviders(config), false);
});

test("providers omit realtime STT unless it is enabled with a socket factory", () => {
  assert.equal("streamingStt" in createAgentProviders(selfHostedConfig), false);
  assert.equal(
    "streamingStt" in
      createAgentProviders(selfHostedConfig, () => {
        throw new Error("the factory must not be used when realtime STT is off");
      }),
    false
  );
});

test("providers build realtime STT when it is enabled and a socket factory is injected", () => {
  const config = loadAgentConfig({
    ...selfHostedEnv,
    STT_REALTIME_ENABLED: "true",
    STT_API_KEY: "realtime-key"
  });
  let opened = 0;
  const providers = createAgentProviders(config, () => {
    opened += 1;
    throw new Error("no socket should be opened during construction");
  });

  assert.equal("streamingStt" in providers, true);
  assert.equal(opened, 0);
  const streamingStt = providers.streamingStt as { url?: string };

  // The realtime provider authenticates on its own OpenAI-hosted WebSocket URL.
  assert.equal(streamingStt.url, "wss://api.openai.com/v1/realtime");
  assert.equal(internals(providers.streamingStt).apiKey, "realtime-key");
  assert.equal(internals(providers.streamingStt).model, "Systran/faster-whisper-small");
});

test("providers build realtime STT with the inherited LLM key when no STT key is set", () => {
  const config = loadAgentConfig({
    ...selfHostedEnv,
    STT_REALTIME_ENABLED: "true",
    LLM_API_KEY: "llm-key"
  });
  const providers = createAgentProviders(config, () => {
    throw new Error("no socket should be opened during construction");
  });

  // The realtime provider authenticates on its own OpenAI-hosted WebSocket URL,
  // so the agent forwards the LLM credential rather than the STT base URL.
  assert.equal(internals(providers.streamingStt).apiKey, "llm-key");
});

test("providers expose the upstream provider interfaces", () => {
  const providers = createAgentProviders(selfHostedConfig);

  assert.equal(typeof providers.llm.streamText, "function");
  assert.equal(typeof providers.stt.transcribe, "function");
  assert.equal(typeof providers.tts?.synthesize, "function");
});