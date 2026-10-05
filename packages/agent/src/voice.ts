import type {
  ProviderCallOptions,
  TTSProvider,
  TTSStreamChunk,
  TTSSynthesisInput
} from "@open-gpt-live/adapters";

export type ReplyLanguage = "es" | "en" | "unknown";

/**
 * Decides whether a reply is Spanish or English.
 *
 * The rule is a stop-word vote, not a real language model: both languages are
 * being distinguished only to pick a voice, and a wrong vote between two known
 * voices is far less costly than the alternative of speaking English with
 * Spanish phonetics. Two signals are counted separately because they fail
 * differently. Spanish-only characters (`ñ`, `¿`, `¡`, accented vowels) are
 * conclusive when present, since English text never contains them and Spanish
 * text usually does. Absent those, the more frequent function word wins, so
 * short greetings still resolve instead of falling through to the fallback.
 * Anything without a clear winner returns "unknown" and keeps the fallback
 * voice: an honest "no idea" beats a confident wrong accent.
 */
export function detectLanguage(text: string): ReplyLanguage {
  const normalized = text.toLowerCase();
  if (normalized.trim().length === 0) {
    return "unknown";
  }

  if (/[ñ¿¡áéíóúü]/.test(normalized)) {
    return "es";
  }

  let spanish = 0;
  let english = 0;
  for (const word of normalized.split(/[^a-záéíóúüñ']+/)) {
    if (SPANISH_WORDS.has(word)) spanish += 1;
    if (ENGLISH_WORDS.has(word)) english += 1;
  }

  if (spanish > english) return "es";
  if (english > spanish) return "en";
  return "unknown";
}

const SPANISH_WORDS = new Set([
  "que",
  "de",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "para",
  "como",
  "con",
  "por",
  "muy",
  "porque",
  "hola",
  "gracias",
  "puedes",
  "puedo",
  "ayuda",
  "esto",
  "esa",
  "ese",
  "pero",
  "tengo",
  "donde",
  "cuando",
  "ser",
  "estar",
  "soy",
  "eres"
]);

const ENGLISH_WORDS = new Set([
  "the",
  "is",
  "are",
  "and",
  "to",
  "of",
  "you",
  "what",
  "with",
  "for",
  "hello",
  "thanks",
  "i",
  "can",
  "help",
  "this",
  "that",
  "but",
  "have",
  "where",
  "when",
  "do",
  "does",
  "not"
]);

export interface LocalizedVoiceOptions {
  /** Voice used for Spanish replies. */
  spanish: string;
  /** Voice used for English replies. */
  english: string;
  /** Voice used when the language cannot be decided. */
  fallback?: string;
}

/**
 * Routes each synthesis to a voice that speaks the reply's language.
 *
 * Kokoro ships one voice per language inside a single model, so the model never
 * changes; only the voice does. `TTSSynthesisInput.voice` is per call, so this
 * wraps the real provider and overrides the voice just for that segment without
 * touching the gateway, which lets the agent answer a Spanish question in
 * Spanish and an English one in English, and even switch language mid-reply.
 */
export class LocalizedVoiceTTSProvider implements TTSProvider {
  private readonly inner: TTSProvider;
  private readonly options: LocalizedVoiceOptions;

  constructor(inner: TTSProvider, options: LocalizedVoiceOptions) {
    this.inner = inner;
    this.options = options;
  }

  synthesize(
    input: TTSSynthesisInput,
    options?: ProviderCallOptions
  ): AsyncIterable<TTSStreamChunk> {
    return this.inner.synthesize(this.withVoice(input), options);
  }

  private withVoice(input: TTSSynthesisInput): TTSSynthesisInput {
    const voice = this.voiceFor(detectLanguage(input.text));
    return voice === undefined ? input : { ...input, voice };
  }

  private voiceFor(language: ReplyLanguage): string | undefined {
    if (language === "es") return this.options.spanish;
    if (language === "en") return this.options.english;
    return this.options.fallback;
  }
}