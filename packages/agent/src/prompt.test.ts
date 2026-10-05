import assert from "node:assert/strict";
import { test } from "vitest";

import {
  DEFAULT_SYSTEM_PROMPT,
  resolveSystemPrompt
} from "./prompt.js";

test("the default prompt is voice-optimized and free of the upstream persona", () => {
  assert.match(DEFAULT_SYSTEM_PROMPT, /short, plain sentences/);
  assert.match(DEFAULT_SYSTEM_PROMPT, /Never use markdown/);
  assert.match(DEFAULT_SYSTEM_PROMPT, /one idea each/);
  assert.doesNotMatch(DEFAULT_SYSTEM_PROMPT, /OpenGPT Live/);
  assert.doesNotMatch(DEFAULT_SYSTEM_PROMPT, /Open Voice, a voice assistant.*OpenGPT/);
});

test("prompt resolution falls back to the default when nothing is configured", () => {
  assert.equal(resolveSystemPrompt(), DEFAULT_SYSTEM_PROMPT);
  assert.equal(resolveSystemPrompt({}), DEFAULT_SYSTEM_PROMPT);
  assert.equal(resolveSystemPrompt({ systemPrompt: "   " }), DEFAULT_SYSTEM_PROMPT);
});

test("prompt resolution prefers AGENT_SYSTEM_PROMPT over the default", () => {
  const resolved = resolveSystemPrompt({ systemPrompt: "  Be terse.  " });

  assert.equal(resolved, "Be terse.");
  assert.notEqual(resolved, DEFAULT_SYSTEM_PROMPT);
});

test("prompt resolution prefers AGENT_SYSTEM_PROMPT_FILE over the inline prompt", () => {
  const resolved = resolveSystemPrompt(
    { systemPrompt: "inline prompt", systemPromptFile: "/etc/open-voice/prompt.txt" },
    () => "  File persona.  \n"
  );

  assert.equal(resolved, "File persona.");
});

test("prompt resolution fails loudly when the prompt file cannot be read", () => {
  const readTextFile = (): string => {
    throw new Error("ENOENT: no such file or directory");
  };

  assert.throws(
    () =>
      resolveSystemPrompt(
        { systemPrompt: "inline prompt", systemPromptFile: "/missing/prompt.txt" },
        readTextFile
      ),
    /AGENT_SYSTEM_PROMPT_FILE is not readable: \/missing\/prompt\.txt \(ENOENT: no such file or directory\)/
  );
});

test("prompt resolution rejects an empty prompt file instead of using the default", () => {
  assert.throws(
    () => resolveSystemPrompt({ systemPromptFile: "/etc/open-voice/prompt.txt" }, () => "\n \n"),
    /AGENT_SYSTEM_PROMPT_FILE is empty: \/etc\/open-voice\/prompt\.txt/
  );
});