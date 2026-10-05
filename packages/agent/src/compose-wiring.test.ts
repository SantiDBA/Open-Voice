import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

/**
 * Compose wiring guard.
 *
 * The agent reads its configuration from the container environment, and compose
 * only passes a variable into a container if the service block names it. Two
 * variables were once added to the tracked template and to the agent's parser
 * but never named in the `agent` service block, so they silently never reached
 * the process: English kept using the Spanish voice, and a latency measurement
 * attributed to one of them was really just noise. Both failures were invisible
 * because an absent variable simply falls back to a default.
 *
 * These tests make that class of mistake fail loudly.
 */

const repoFile = (name: string): string =>
  readFileSync(new URL(`../../../${name}`, import.meta.url), "utf8");

/** Environment variable names the agent's config parser reads. */
function agentEnvVars(): string[] {
  const source = repoFile("packages/agent/src/config.ts");
  return [...new Set([...source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!))].sort();
}

/** Keys declared in the `agent` service block of the compose file. */
function composeAgentEnvKeys(): Set<string> {
  const compose = repoFile("docker-compose.yml");
  const start = compose.search(/^ {2}agent:\s*$/m);
  assert.notEqual(start, -1, "the compose file must declare an `agent` service");

  const rest = compose.slice(start + 1);
  const nextService = rest.search(/^ {2}\S/m);
  const block = nextService === -1 ? rest : rest.slice(0, nextService);

  const keys = new Set<string>();
  for (const line of block.split("\n")) {
    const match = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
    if (match) keys.add(match[1]!);
  }
  return keys;
}

test("every variable the agent parses is passed into its container", () => {
  const declared = composeAgentEnvKeys();
  const missing = agentEnvVars().filter((name) => !declared.has(name));
  assert.deepEqual(
    missing,
    [],
    "these are read by packages/agent/src/config.ts but never passed by the compose `agent` service, so they silently fall back to defaults"
  );
});

test("every variable compose passes to the agent is documented", () => {
  const template = repoFile("env.example.template");
  const undocumented = [...composeAgentEnvKeys()].filter(
    (name) => !new RegExp(`^#?\\s*${name}=`, "m").test(template)
  );
  assert.deepEqual(
    undocumented,
    [],
    "the compose `agent` service passes variables that the tracked template never mentions"
  );
});

test("the template and the compose file agree on every shared default", () => {
  const template = repoFile("env.example.template");
  const compose = repoFile("docker-compose.yml");
  const disagreements: string[] = [];

  for (const name of composeAgentEnvKeys()) {
    const inTemplate = new RegExp(`^${name}=(.+)$`, "m").exec(template)?.[1]?.trim();
    const inCompose = new RegExp(`\\$\\{${name}:-([^}]*)\\}`).exec(compose)?.[1]?.trim();
    if (inTemplate === undefined || inCompose === undefined) continue;
    if (inTemplate !== inCompose) {
      disagreements.push(`${name}: template=${inTemplate} compose=${inCompose}`);
    }
  }

  assert.deepEqual(
    disagreements,
    [],
    "the tracked template and the compose fallback must not drift apart"
  );
});
