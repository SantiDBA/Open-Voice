import { readFileSync } from "node:fs";

import type { PromptConfig } from "./config.js";

/**
 * The default Open Voice persona.
 *
 * This text is spoken out loud by the text-to-speech provider, so it forbids
 * everything a listener cannot parse from audio: markdown, lists, code blocks
 * and emoji.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  "You are Open Voice, a voice assistant that speaks with the user out loud.",
  "Your entire reply is read aloud by a speech synthesizer.",
  "Speak in short, plain sentences with one idea each.",
  "Never use markdown, bullet points, numbered lists, code blocks, tables or emoji.",
  "Never spell out punctuation, symbols, URLs or formatting.",
  "Keep replies to a few sentences and stop talking as soon as the point is made.",
  "If you are interrupted, stop immediately and answer only what was asked.",
  "If you did not understand the question, ask the user to repeat it in one short sentence."
].join(" ");

/**
 * Resolves the system prompt with a single, loud precedence chain:
 * `AGENT_SYSTEM_PROMPT_FILE`, then `AGENT_SYSTEM_PROMPT`, then the default.
 *
 * A configured but unreadable or blank prompt file is a configuration error,
 * never a reason to fall through to the default.
 */
export function resolveSystemPrompt(
  config: PromptConfig = {},
  readTextFile: (path: string) => string = (path) =>
    readFileSync(path, "utf8")
): string {
  const promptFile = config.systemPromptFile;
  if (promptFile !== undefined) {
    let contents: string;
    try {
      contents = readTextFile(promptFile);
    } catch (error) {
      throw new Error(
        `AGENT_SYSTEM_PROMPT_FILE is not readable: ${promptFile} (${message(error)})`
      );
    }
    const trimmed = contents.trim();
    if (!trimmed) {
      throw new Error(`AGENT_SYSTEM_PROMPT_FILE is empty: ${promptFile}`);
    }
    return trimmed;
  }

  const inline = config.systemPrompt?.trim();
  if (inline) return inline;

  return DEFAULT_SYSTEM_PROMPT;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}