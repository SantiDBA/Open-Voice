import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, test } from "vitest";

import type { LLMMessage } from "@open-gpt-live/adapters";

import type { ToolAuditEntry } from "./audit.js";
import { ToolLoopLlmProvider } from "./llm.js";
import { createSandboxClient } from "./sandbox-client.js";
import { createHostClient } from "./host-client.js";

/**
 * The loop is tested against two throwaway HTTP servers rather than mocks: the
 * thing worth proving is the wire behaviour — SSE fragments reassembled, the
 * tool result fed back in the right shape, and a cancel that actually leaves the
 * process when the turn is interrupted.
 */

interface Captured {
  body: Record<string, unknown>;
}

/** A streaming LLM that plays a scripted turn per request. */
function fakeLlm(turns: string[][]): Promise<{
  server: Server;
  url: string;
  requests: Captured[];
}> {
  const requests: Captured[] = [];
  let call = 0;

  const server = createServer((request: IncomingMessage, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      requests.push({ body: JSON.parse(raw) as Record<string, unknown> });
      const script = turns[Math.min(call, turns.length - 1)] ?? [];
      call += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const frame of script) {
        response.write(`data: ${frame}\n\n`);
      }
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });

  return listen(server).then((url) => ({ server, url, requests }));
}

interface SandboxCapture {
  actions: Array<Record<string, unknown>>;
  cancels: string[];
}

function fakeSandbox(
  outcome: Record<string, unknown>,
  options: { hang?: boolean } = {}
): Promise<{ server: Server; url: string; captured: SandboxCapture }> {
  const captured: SandboxCapture = { actions: [], cancels: [] };
  const held: Array<() => void> = [];

  const server = createServer((request, response) => {
    const url = request.url ?? "";

    if (request.method === "POST" && url.endsWith("/cancel")) {
      captured.cancels.push(decodeURIComponent(url.split("/")[2] ?? ""));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, cancelled: true }));
      for (const release of held.splice(0)) {
        release();
      }
      return;
    }

    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      captured.actions.push(JSON.parse(raw) as Record<string, unknown>);
      const send = (): void => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, actionId: "a", ...outcome }));
      };
      if (options.hang) {
        held.push(send);
        return;
      }
      send();
    });
  });

  return listen(server).then((url) => ({ server, url, captured }));
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/** One text delta as the API streams them. */
function content(text: string): string {
  return JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] });
}

/** A tool-call fragment; arguments arrive split, which is the point. */
function toolFragment(index: number, fragment: Record<string, unknown>): string {
  return JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index, ...fragment }] }, finish_reason: null }]
  });
}

function finish(reason: string): string {
  return JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] });
}

const systemMessage: LLMMessage = { role: "system", content: "You are a test." };
const userMessage: LLMMessage = { role: "user", content: "corré echo hola" };

/** Timeout for a turn that should complete without hanging. */
const ABORT_TIMEOUT_MS = 30_000;

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    // fetch keeps connections alive; without this the teardown waits on them.
    server.closeAllConnections();
    server.close();
  }
});

beforeEach(() => {
  servers.length = 0;
});

/** Polls until `check` is true, for the fire-and-forget cancel request. */
async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}

async function build(options: {
  turns: string[][];
  outcome?: Record<string, unknown>;
  hang?: boolean;
  maxIterations?: number;
  approval?: "sandbox" | "all";
  decide?: "approve" | "deny";
  /** Configures a host executor, which is what makes host_exec available. */
  withHost?: boolean;
}): Promise<{
  provider: ToolLoopLlmProvider;
  llm: { requests: Captured[] };
  sandbox: SandboxCapture;
  host: SandboxCapture;
  audit: ToolAuditEntry[];
  events: Array<Record<string, unknown>>;
}> {
  const llm = await fakeLlm(options.turns);
  const box = await fakeSandbox(options.outcome ?? { status: "ok", kind: "exec", exitCode: 0 }, {
    hang: options.hang
  });
  // A second server stands in for the host executor: same protocol, different
  // trust boundary, so what matters is which one received the request.
  const host = await fakeSandbox({ status: "ok", kind: "exec", exitCode: 0 });
  servers.push(llm.server, box.server, host.server);

  const audit: ToolAuditEntry[] = [];
  const events: Array<Record<string, unknown>> = [];

  const provider = new ToolLoopLlmProvider({
    baseUrl: llm.url,
    model: "test-model",
    sandbox: createSandboxClient({ baseUrl: box.url, token: "secret-token" }),
    ...(options.withHost
      ? { host: createHostClient({ baseUrl: host.url, token: "host-token" }) }
      : {}),
    audit: { info: (_event, fields) => audit.push(fields as unknown as ToolAuditEntry) },
    reporter: {
      call: (notice) => events.push({ type: "call", ...notice }),
      result: (notice) => events.push({ type: "result", ...notice }),
      confirm: async (request) => {
        events.push({ type: "gate", ...request });
        return options.decide ?? "approve";
      }
    },
    approval: options.approval ?? "sandbox",
    maxIterations: options.maxIterations ?? 8,
    actionTimeoutMs: 5_000,
    maxOutputBytes: 1_024
  });

  return { provider, llm, sandbox: box.captured, host: host.captured, audit, events };
}

async function speak(provider: ToolLoopLlmProvider, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const chunks: string[] = [];
    for await (const chunk of provider.streamText([systemMessage, userMessage], { signal: controller.signal })) {
      chunks.push(chunk.delta);
    }
    return chunks.join("");
  } finally {
    clearTimeout(timer);
  }
}

// The model names host_exec, which must go to the host executor, not the
// sandbox.
test("routes host_exec to the host executor, never the sandbox", async () => {
  const { provider, host, sandbox, llm } = await build({
    turns: [
      [
        toolFragment(0, { id: "call_0", function: { name: "host_exec", arguments: JSON.stringify({ command: "echo host-works" }) } }),
        finish("tool_calls")
      ],
      [content("ran on host: yes")]
    ],
    withHost: true
  });

  const text = await speak(provider, ABORT_TIMEOUT_MS);

  assert.equal(sandbox.actions.length, 0, "the sandbox never sees a host action");
  assert.equal(host.actions.length, 1);
  assert.equal(host.actions[0]!.kind, "exec");
  assert.equal(host.actions[0]!.command, "echo host-works");
  assert.equal(host.actions[0]!.cwd, undefined, "an absent cwd stays absent, not empty");
  assert.equal(llm.requests.length, 2, "call + wrap-up with the tool result");
  assert.ok(text.includes("ran on host"));
});

test("refuses host_exec when no executor is configured", async () => {
  const { provider, sandbox, host, events } = await build({
    turns: [
      [
        toolFragment(0, { id: "call_0", function: { name: "host_exec", arguments: JSON.stringify({ command: "echo hi" }) } }),
        finish("tool_calls")
      ],
      [content("ok, I could not do that")]
    ],
    withHost: false
  });

  const text = await speak(provider, ABORT_TIMEOUT_MS);

  assert.equal(sandbox.actions.length, 0);
  assert.equal(host.actions.length, 0, "nothing is posted to the host executor");
  assert.ok(events.some((e) => e.outcome === "refused"), "the refusal is logged");
  assert.ok(text.includes("could not"), "the refusal is reported to the model in words");
});

async function collect(provider: ToolLoopLlmProvider): Promise<string> {
  let text = "";
  for await (const chunk of provider.streamText([systemMessage, userMessage])) {
    text += chunk.delta;
  }
  return text;
}

test("runs a tool call and speaks the ack and the answer", async () => {
  const { provider, llm, sandbox, audit } = await build({
    turns: [
      [
        content("Dale, lo corro. "),
        toolFragment(0, { id: "call_1", function: { name: "run_command" } }),
        // The arguments stream in two fragments and are only JSON once joined.
        toolFragment(0, { function: { arguments: '{"comm' } }),
        toolFragment(0, { function: { arguments: 'and":"echo hola"}' } }),
        finish("tool_calls")
      ],
      [content("Listo: hola."), finish("stop")]
    ],
    outcome: { status: "ok", kind: "exec", exitCode: 0, stdout: "hola\n" }
  });

  const spoken = await collect(provider);

  assert.equal(spoken, "Dale, lo corro. Listo: hola.");
  assert.equal(llm.requests.length, 2);

  // The first call offered the tools; the second carried the tool result back.
  assert.ok(Array.isArray(llm.requests[0]!.body["tools"]));
  const secondMessages = llm.requests[1]!.body["messages"] as Array<Record<string, unknown>>;
  const toolMessage = secondMessages.find((message) => message["role"] === "tool");
  assert.ok(toolMessage, "the tool result must be sent back to the model");
  assert.equal(toolMessage["tool_call_id"], "call_1");
  assert.match(String(toolMessage["content"]), /"untrusted_output":true/);
  assert.match(String(toolMessage["content"]), /hola/);

  // The sandbox got the action the model asked for, with the credential.
  assert.equal(sandbox.actions.length, 1);
  assert.deepEqual(
    { kind: sandbox.actions[0]!["kind"], command: sandbox.actions[0]!["command"] },
    { kind: "exec", command: "echo hola" }
  );
  assert.ok(typeof sandbox.actions[0]!["actionId"] === "string");

  // And it was audited.
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.tool, "run_command");
  assert.equal(audit[0]!.outcome, "ok");
});

test("answers without tools when the model does not ask for one", async () => {
  const { provider, llm, sandbox } = await build({
    turns: [[content("Hola."), finish("stop")]]
  });

  assert.equal(await collect(provider), "Hola.");
  assert.equal(llm.requests.length, 1);
  assert.equal(sandbox.actions.length, 0);
});

test("feeds an unknown tool back as a refusal instead of failing the turn", async () => {
  const { provider, llm, audit } = await build({
    turns: [
      [
        toolFragment(0, { id: "c1", function: { name: "rm_rf_everything", arguments: "{}" } }),
        finish("tool_calls")
      ],
      [content("No puedo hacer eso."), finish("stop")]
    ]
  });

  const spoken = await collect(provider);

  assert.equal(spoken, "No puedo hacer eso.");
  const secondMessages = llm.requests[1]!.body["messages"] as Array<Record<string, unknown>>;
  const toolMessage = secondMessages.find((message) => message["role"] === "tool");
  assert.match(String(toolMessage?.["content"]), /"status":"refused"/);
  assert.equal(audit[0]!.outcome, "refused");
});

test("reports a sandbox failure as a result the model can describe", async () => {
  const llm = await fakeLlm([
    [
      toolFragment(0, { id: "c1", function: { name: "run_command", arguments: '{"command":"x"}' } }),
      finish("tool_calls")
    ],
    [content("Falló."), finish("stop")]
  ]);
  servers.push(llm.server);

  // A sandbox that is not there at all.
  const provider = new ToolLoopLlmProvider({
    baseUrl: llm.url,
    model: "test-model",
    sandbox: createSandboxClient({ baseUrl: "http://127.0.0.1:1", token: "t" }),
    audit: { info: () => undefined },
    reporter: {
      call: () => undefined,
      result: () => undefined,
      confirm: async () => "approve"
    },
    approval: "sandbox",
    maxIterations: 4,
    actionTimeoutMs: 1_000,
    maxOutputBytes: 1_024
  });

  assert.equal(await collect(provider), "Falló.");
  const secondMessages = llm.requests[1]!.body["messages"] as Array<Record<string, unknown>>;
  const toolMessage = secondMessages.find((message) => message["role"] === "tool");
  assert.match(String(toolMessage?.["content"]), /"status":"error"/);
});

test("wraps up without tools once the iteration limit is reached", async () => {
  const toolTurn = [
    toolFragment(0, { id: "c1", function: { name: "list_dir", arguments: "{}" } }),
    finish("tool_calls")
  ];
  const { provider, llm } = await build({
    turns: [toolTurn, toolTurn, [content("Me quedé sin pasos."), finish("stop")]],
    maxIterations: 2
  });

  assert.equal(await collect(provider), "Me quedé sin pasos.");
  assert.equal(llm.requests.length, 3);

  // The wrap-up call offers no tools and says why.
  assert.equal("tools" in llm.requests[2]!.body, false);
  const messages = llm.requests[2]!.body["messages"] as Array<Record<string, unknown>>;
  assert.ok(
    messages.some((message) => String(message["content"]).includes("tool limit")),
    "the model must be told why it cannot call more tools"
  );
});

test("cancels the running action at the sandbox when the turn is interrupted", async () => {
  const { provider, sandbox } = await build({
    turns: [
      [
        toolFragment(0, { id: "c1", function: { name: "run_command", arguments: '{"command":"sleep 30"}' } }),
        finish("tool_calls")
      ],
      [content("no debería llegar"), finish("stop")]
    ],
    hang: true
  });

  const controller = new AbortController();
  const pending = (async () => {
    let text = "";
    for await (const chunk of provider.streamText([systemMessage, userMessage], {
      signal: controller.signal
    })) {
      text += chunk.delta;
    }
    return text;
  })();

  // Let the tool call reach the sandbox, then interrupt like barge-in does.
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();

  const spoken = await pending;
  assert.equal(spoken, "", "an interrupted turn speaks nothing further");
  assert.ok(
    await waitFor(() => sandbox.cancels.length === 1),
    "the command must be cancelled at the sandbox, not merely abandoned"
  );
});

test("reports the call and the result so the UI can follow along", async () => {
  const { provider, events } = await build({
    turns: [
      [
        toolFragment(0, { id: "c1", function: { name: "list_dir", arguments: "{}" } }),
        finish("tool_calls")
      ],
      [content("Listo."), finish("stop")]
    ],
    outcome: { status: "ok", kind: "list_dir", entries: [] }
  });

  await collect(provider);

  assert.equal(events[0]!["type"], "call");
  assert.equal(events[0]!["tool"], "list_dir");
  assert.equal(events[0]!["approval"], "auto", "a confined tool runs without asking");
  assert.equal(events[1]!["type"], "result");
  assert.equal(events[1]!["outcome"], "ok");
});

test("asks before every call when approval is set to all, and runs it once approved", async () => {
  const { provider, events, sandbox } = await build({
    turns: [
      [
        toolFragment(0, { id: "c1", function: { name: "list_dir", arguments: "{}" } }),
        finish("tool_calls")
      ],
      [content("Listo."), finish("stop")]
    ],
    approval: "all",
    decide: "approve"
  });

  await collect(provider);

  const gate = events.find((event) => event["type"] === "gate");
  assert.ok(gate, "approval=all must raise a gate");
  assert.equal(gate["tool"], "list_dir");
  assert.equal(sandbox.actions.length, 1, "an approved action runs");
  assert.equal(events.find((event) => event["type"] === "call")?.["approval"], "approved");
});

test("does not run an action the user denied, and tells the model so", async () => {
  const { provider, llm, sandbox, audit } = await build({
    turns: [
      [
        toolFragment(0, { id: "c1", function: { name: "run_command", arguments: '{"command":"rm -rf x"}' } }),
        finish("tool_calls")
      ],
      [content("No lo hice."), finish("stop")]
    ],
    approval: "all",
    decide: "deny"
  });

  assert.equal(await collect(provider), "No lo hice.");

  assert.equal(sandbox.actions.length, 0, "a denied action must not reach the sandbox");
  const secondMessages = llm.requests[1]!.body["messages"] as Array<Record<string, unknown>>;
  const toolMessage = secondMessages.find((message) => message["role"] === "tool");
  assert.match(String(toolMessage?.["content"]), /"status":"denied"/);
  assert.equal(audit[0]!.outcome, "denied");
});
