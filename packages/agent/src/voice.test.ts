import assert from "node:assert/strict";
import { test } from "vitest";

import type {
  ProviderCallOptions,
  TTSProvider,
  TTSStreamChunk,
  TTSSynthesisInput
} from "@open-gpt-live/adapters";

import { detectLanguage, LocalizedVoiceTTSProvider } from "./voice.js";

/** Records what the wrapper delegated, and replays a fixed audio stream. */
class RecordingTtsProvider implements TTSProvider {
  readonly calls: Array<{ input: TTSSynthesisInput; options?: ProviderCallOptions }> =
    [];

  synthesize(
    input: TTSSynthesisInput,
    options?: ProviderCallOptions
  ): AsyncIterable<TTSStreamChunk> {
    this.calls.push({ input, options });
    return (async function* (): AsyncGenerator<TTSStreamChunk, void, undefined> {
      yield { audio: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg", format: "mp3" };
      yield { audio: new Uint8Array([4, 5, 6]), mimeType: "audio/mpeg", format: "mp3" };
    })();
  }
}

async function collect(
  provider: TTSProvider,
  input: TTSSynthesisInput,
  options?: ProviderCallOptions
): Promise<TTSStreamChunk[]> {
  const chunks: TTSStreamChunk[] = [];
  for await (const chunk of provider.synthesize(input, options)) {
    chunks.push(chunk);
  }
  return chunks;
}

const voices = { spanish: "ef_dora", english: "af_heart", fallback: "zm_yunjian" };

test("detects Spanish from accented and inverted characters", () => {
  assert.equal(detectLanguage("Hola, ¿cómo estás?"), "es");
  assert.equal(detectLanguage("El mañana está frío"), "es");
  assert.equal(detectLanguage("Añadir más años"), "es");
});

test("detects Spanish from function words alone", () => {
  assert.equal(detectLanguage("Hola, gracias por la ayuda de ayer"), "es");
  assert.equal(detectLanguage("que es esto para ti"), "es");
});

test("detects English from function words", () => {
  assert.equal(detectLanguage("Hello, how can I help you today"), "en");
  assert.equal(detectLanguage("what is this for"), "en");
});

test("returns unknown for empty, ambiguous and language-neutral text", () => {
  assert.equal(detectLanguage(""), "unknown");
  assert.equal(detectLanguage("   "), "unknown");
  assert.equal(detectLanguage("ok"), "unknown");
  assert.equal(detectLanguage("2026"), "unknown");
  assert.equal(detectLanguage("the of and"), "en", "a clear word-count winner still resolves");
  assert.equal(detectLanguage("uno dos tres"), "unknown", "no overlap with either vocabulary");
});

test("routes a Spanish segment to the Spanish voice", async () => {
  const inner = new RecordingTtsProvider();
  const provider = new LocalizedVoiceTTSProvider(inner, voices);
  await collect(provider, { text: "Hola, ¿qué tal?" });
  assert.equal(inner.calls[0]?.input.voice, "ef_dora");
});

test("routes an English segment to the English voice", async () => {
  const inner = new RecordingTtsProvider();
  const provider = new LocalizedVoiceTTSProvider(inner, voices);
  await collect(provider, { text: "Hello, what can I do for you" });
  assert.equal(inner.calls[0]?.input.voice, "af_heart");
});

test("falls back for an undecidable language and for empty text", async () => {
  const inner = new RecordingTtsProvider();
  const provider = new LocalizedVoiceTTSProvider(inner, voices);
  await collect(provider, { text: "2026" });
  await collect(provider, { text: "" });
  assert.equal(inner.calls[0]?.input.voice, "zm_yunjian");
  assert.equal(inner.calls[1]?.input.voice, "zm_yunjian");
});

test("leaves the voice untouched when there is no fallback", async () => {
  const inner = new RecordingTtsProvider();
  const provider = new LocalizedVoiceTTSProvider(inner, {
    spanish: "ef_dora",
    english: "af_heart"
  });
  await collect(provider, { text: "2026" });
  assert.equal(inner.calls[0]?.input.voice, undefined);
});

test("passes format, options and audio chunks through untouched", async () => {
  const inner = new RecordingTtsProvider();
  const provider = new LocalizedVoiceTTSProvider(inner, voices);
  const controller = new AbortController();
  const options: ProviderCallOptions = { signal: controller.signal };
  const chunks = await collect(provider, { text: "Hello there", format: "mp3" }, options);

  assert.equal(inner.calls[0]?.input.format, "mp3");
  assert.equal(inner.calls[0]?.options?.signal, controller.signal);
  assert.equal(chunks.length, 2);
  assert.deepEqual([...chunks[0]!.audio], [1, 2, 3]);
  assert.deepEqual([...chunks[1]!.audio], [4, 5, 6]);
});

test("a caller-supplied per-call voice is replaced by the routed one", async () => {
  const inner = new RecordingTtsProvider();
  const provider = new LocalizedVoiceTTSProvider(inner, voices);
  await collect(provider, { text: "Hello there", voice: "bm_george" });
  assert.equal(inner.calls[0]?.input.voice, "af_heart");
});