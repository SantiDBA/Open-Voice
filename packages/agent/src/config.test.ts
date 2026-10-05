import assert from "node:assert/strict";
import { test } from "vitest";

import { loadAgentConfig } from "./config.js";

const selfHostedEnv = {
  LLM_BASE_URL: "http://127.0.0.1:20128/v1",
  STT_BASE_URL: "http://speaches:8000/v1",
  TTS_BASE_URL: "http://speaches:8000/v1"
} satisfies NodeJS.ProcessEnv;

test("config falls back to the documented defaults", () => {
  const config = loadAgentConfig({ LLM_API_KEY: "llm-key", STT_API_KEY: "stt-key" });

  assert.equal(config.llm.baseUrl, "https://api.openai.com/v1");
  assert.equal(config.llm.model, "gpt-4o-mini");
  assert.equal(config.llm.apiKey, "llm-key");
  assert.equal(config.stt.apiKey, "stt-key");
  assert.equal(config.stt.baseUrl, "https://api.openai.com/v1");
  assert.equal(config.stt.model, "whisper-1");
  assert.equal(config.stt.realtimeEnabled, false);
  assert.equal(config.tts.baseUrl, "https://api.openai.com/v1");
  assert.equal(config.tts.model, "tts-1");
  assert.equal(config.tts.format, "mp3");
  assert.equal(config.tts.voice, undefined);
  assert.equal(config.tts.enabled, false);
  assert.equal(config.prompt.systemPrompt, undefined);
  assert.equal(config.prompt.systemPromptFile, undefined);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8787);
  assert.equal(config.logLevel, "info");
  assert.deepEqual(config.allowedOrigins, []);
});

test("config parses the full self-hosted hybrid profile", () => {
  const config = loadAgentConfig({
    ...selfHostedEnv,
    LLM_MODEL: "auto/best-chat",
    STT_MODEL: "Systran/faster-whisper-small",
    TTS_MODEL: "hexgrad/Kokoro-82M",
    TTS_VOICE: "af_heart",
    TTS_FORMAT: "wav",
    TTS_ENABLED: "true",
    GATEWAY_HOST: "127.0.0.1",
    GATEWAY_PORT: "9000",
    ALLOWED_ORIGINS: "http://localhost:3000, https://voice.example.com",
    LOG_LEVEL: "debug"
  });

  assert.equal(config.llm.baseUrl, "http://127.0.0.1:20128/v1");
  assert.equal(config.llm.model, "auto/best-chat");
  assert.equal(config.stt.baseUrl, "http://speaches:8000/v1");
  assert.equal(config.stt.model, "Systran/faster-whisper-small");
  assert.equal(config.tts.baseUrl, "http://speaches:8000/v1");
  assert.equal(config.tts.model, "hexgrad/Kokoro-82M");
  assert.equal(config.tts.voice, "af_heart");
  assert.equal(config.tts.format, "wav");
  assert.equal(config.tts.enabled, true);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 9000);
  assert.deepEqual(config.allowedOrigins, [
    "http://localhost:3000",
    "https://voice.example.com"
  ]);
  assert.equal(config.logLevel, "debug");
});

test("config trims values and treats blank values as unset", () => {
  const config = loadAgentConfig({
    ...selfHostedEnv,
    LLM_MODEL: "   ",
    TTS_VOICE: "  af_heart  ",
    GATEWAY_HOST: " 127.0.0.1 ",
    GATEWAY_PORT: " 9090 ",
    LOG_LEVEL: " warn ",
    LLM_API_KEY: "  llm-key  "
  });

  assert.equal(config.llm.model, "gpt-4o-mini");
  assert.equal(config.tts.voice, "af_heart");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 9090);
  assert.equal(config.logLevel, "warn");
  assert.equal(config.llm.apiKey, "llm-key");
});

test("config reads the prompt namespace", () => {
  const fromInline = loadAgentConfig({
    ...selfHostedEnv,
    AGENT_SYSTEM_PROMPT: "Be brief."
  });
  assert.equal(fromInline.prompt.systemPrompt, "Be brief.");
  assert.equal(fromInline.prompt.systemPromptFile, undefined);

  const fromFile = loadAgentConfig({
    ...selfHostedEnv,
    AGENT_SYSTEM_PROMPT: "Be brief.",
    AGENT_SYSTEM_PROMPT_FILE: "/etc/open-voice/prompt.txt"
  });
  assert.equal(fromFile.prompt.systemPrompt, "Be brief.");
  assert.equal(fromFile.prompt.systemPromptFile, "/etc/open-voice/prompt.txt");
});

test("config accepts boolean spellings true, false, 1 and 0", () => {
  const on = loadAgentConfig({ ...selfHostedEnv, TTS_ENABLED: "1" });
  const off = loadAgentConfig({ ...selfHostedEnv, TTS_ENABLED: "false" });
  const realtime = loadAgentConfig({
    ...selfHostedEnv,
    STT_REALTIME_ENABLED: "1",
    STT_API_KEY: "realtime-key"
  });

  assert.equal(on.tts.enabled, true);
  assert.equal(off.tts.enabled, false);
  assert.equal(realtime.stt.realtimeEnabled, true);
});

test("config requires an API key for hosted OpenAI endpoints", () => {
  assert.throws(
    () => loadAgentConfig({}),
    /LLM_API_KEY is required for api\.openai\.com/
  );
  assert.throws(
    () =>
      loadAgentConfig({
        LLM_BASE_URL: "http://127.0.0.1:20128/v1",
        STT_BASE_URL: "https://api.openai.com/v1"
      }),
    /STT_API_KEY is required for api\.openai\.com/
  );
  assert.throws(
    () => loadAgentConfig({ LLM_API_KEY: "llm-key" }),
    /STT_API_KEY is required for api\.openai\.com/
  );
});

test("config allows credential-free self-hosted providers", () => {
  const config = loadAgentConfig({ ...selfHostedEnv, TTS_ENABLED: "true" });

  assert.equal(config.llm.apiKey, undefined);
  assert.equal(config.stt.apiKey, undefined);
  assert.equal(config.tts.apiKey, undefined);
  assert.equal(config.tts.enabled, true);
});

test("config treats an unparseable provider URL as hosted and demands a key", () => {
  assert.throws(
    () => loadAgentConfig({ LLM_BASE_URL: "not-a-url" }),
    /LLM_API_KEY is required for api\.openai\.com/
  );
});

test("config fails fast on an invalid GATEWAY_PORT", () => {
  for (const port of ["-1", "87870", "80.5", "abc", "8787a"]) {
    assert.throws(
      () => loadAgentConfig({ ...selfHostedEnv, GATEWAY_PORT: port }),
      /GATEWAY_PORT must be an integer between 0 and 65535/,
      `expected GATEWAY_PORT=${port} to be rejected`
    );
  }
});

test("config fails fast on an invalid boolean", () => {
  assert.throws(
    () => loadAgentConfig({ ...selfHostedEnv, TTS_ENABLED: "yes" }),
    /TTS_ENABLED must be true, false, 1, or 0/
  );
  assert.throws(
    () => loadAgentConfig({ ...selfHostedEnv, STT_REALTIME_ENABLED: "maybe" }),
    /STT_REALTIME_ENABLED must be true, false, 1, or 0/
  );
});

test("config fails fast on an invalid LOG_LEVEL", () => {
  assert.throws(
    () => loadAgentConfig({ ...selfHostedEnv, LOG_LEVEL: "verbose" }),
    /LOG_LEVEL must be one of: debug, info, warn, error/
  );
});

test("config fails fast on invalid ALLOWED_ORIGINS entries", () => {
  assert.throws(
    () => loadAgentConfig({
      LLM_API_KEY: "llm-key",
      STT_API_KEY: "stt-key",
      ALLOWED_ORIGINS: "not-an-origin"
    }),
    /ALLOWED_ORIGINS contains an invalid origin: not-an-origin/
  );
  assert.throws(
    () =>
      loadAgentConfig({
        LLM_API_KEY: "llm-key",
        STT_API_KEY: "stt-key",
        ALLOWED_ORIGINS: "http://localhost:3000/admin"
      }),
    /ALLOWED_ORIGINS must contain exact http\(s\) origins without paths/
  );
});

test("config requires a credential for hosted TTS and for realtime STT", () => {
  assert.throws(
    () => loadAgentConfig({
      LLM_API_KEY: "llm-key",
      STT_API_KEY: "stt-key",
      TTS_ENABLED: "true"
    }),
    /TTS_API_KEY is required for api\.openai\.com when TTS_ENABLED=true/
  );
  assert.throws(
    () => loadAgentConfig({ ...selfHostedEnv, STT_REALTIME_ENABLED: "true" }),
    /STT_REALTIME_ENABLED requires STT_API_KEY or LLM_API_KEY/
  );
});

test("config keeps realtime STT on the OpenAI base URL and inherits the LLM key", () => {
  const config = loadAgentConfig({
    STT_BASE_URL: "http://speaches:8000/v1",
    STT_REALTIME_ENABLED: "true",
    LLM_API_KEY: "llm-key"
  });

  assert.equal(config.stt.realtimeEnabled, true);
  assert.equal(config.stt.baseUrl, "http://speaches:8000/v1");
  assert.equal(config.stt.apiKey, undefined);
  assert.equal(config.stt.realtimeApiKey, "llm-key");
});

test("config defaults TTS to disabled and enables it when a TTS key exists", () => {
  const withoutKey = loadAgentConfig(selfHostedEnv);
  assert.equal(withoutKey.tts.enabled, false);

  const withKey = loadAgentConfig({ ...selfHostedEnv, TTS_API_KEY: "tts-key" });
  assert.equal(withKey.tts.enabled, true);

  const hosted = loadAgentConfig({
    LLM_API_KEY: "llm-key",
    STT_API_KEY: "stt-key",
    TTS_API_KEY: "tts-key"
  });
  assert.equal(hosted.tts.enabled, true);

  const explicitlyDisabled = loadAgentConfig({
    ...selfHostedEnv,
    TTS_API_KEY: "tts-key",
    TTS_ENABLED: "0"
  });
  assert.equal(explicitlyDisabled.tts.enabled, false);
});