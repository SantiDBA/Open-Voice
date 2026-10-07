import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { WebSocket } from "ws";

import { createToolChannel, type ToolChannel } from "./tool-channel.js";

/**
 * The channel is the door to a privileged thing: live tool activity, and the
 * answer to "may I do this". Its tests are therefore about who gets in and what
 * happens when nobody answers.
 */

const ORIGIN = "http://localhost:3000";
const channels: ToolChannel[] = [];
const clients: Client[] = [];

/**
 * A client that buffers from the moment the socket is created. The server
 * greets a connection immediately, and a listener attached after `open` would
 * miss that greeting — a race that shows up as a hung test, not a failure.
 */
interface Client {
  socket: WebSocket;
  next(): Promise<Record<string, unknown>>;
  send(message: unknown): void;
}

function connect(port: number, origin?: string): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, [], {
    ...(origin === undefined ? {} : { origin })
  });

  const queue: Array<Record<string, unknown>> = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];

  socket.on("message", (raw) => {
    const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) {
      waiter(parsed);
    } else {
      queue.push(parsed);
    }
  });

  const client: Client = {
    socket,
    next() {
      const queued = queue.shift();
      if (queued) {
        return Promise.resolve(queued);
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    send(message) {
      socket.send(JSON.stringify(message));
    }
  };
  clients.push(client);

  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(client));
    socket.once("error", reject);
  });
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.socket.terminate();
  }
  for (const channel of channels.splice(0)) {
    await channel.close();
  }
});

const silentLogger = { info: () => undefined, warn: () => undefined };

async function startChannel(
  options: { gateTimeoutMs?: number; allowedOrigins?: string[] } = {}
): Promise<ToolChannel> {
  const channel = await createToolChannel({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: options.allowedOrigins ?? [ORIGIN],
    logger: silentLogger,
    ...(options.gateTimeoutMs === undefined ? {} : { gateTimeoutMs: options.gateTimeoutMs })
  });
  channels.push(channel);
  return channel;
}

test("refuses a connection from an origin that is not allowed", async () => {
  const channel = await startChannel();

  await assert.rejects(
    connect(channel.port, "http://evil.example"),
    /403|Unexpected server response/
  );
});

test("refuses every connection when no origin is configured", async () => {
  const channel = await startChannel({ allowedOrigins: [] });

  await assert.rejects(connect(channel.port, ORIGIN), /403|Unexpected server response/);
});

test("greets an allowed client and accepts it", async () => {
  const channel = await startChannel();
  const client = await connect(channel.port, ORIGIN);

  const hello = await client.next();
  assert.equal(hello["type"], "hello");
  assert.equal(typeof hello["gateTimeoutMs"], "number");
  assert.equal(channel.clients, 1);
});

test("broadcasts tool activity to the connected client", async () => {
  const channel = await startChannel();
  const client = await connect(channel.port, ORIGIN);
  await client.next(); // hello

  channel.call({
    toolCallId: "c1",
    tool: "run_command",
    action: "exec",
    arguments: { command: "echo hola" },
    enforcement: "sandbox",
    approval: "auto"
  });

  const event = await client.next();
  assert.equal(event["type"], "tool.call");
  assert.equal(event["tool"], "run_command");
});

test("an approval resolves with the decision the user sent", async () => {
  const channel = await startChannel();
  const client = await connect(channel.port, ORIGIN);
  await client.next(); // hello

  const decision = channel.confirm({
    toolCallId: "c1",
    tool: "run_command",
    action: "exec",
    arguments: { command: "rm -rf x" },
    reason: "test"
  });

  const request = await client.next();
  assert.equal(request["type"], "gate.request");
  assert.equal(request["toolCallId"], "c1");
  assert.equal(typeof request["expiresInMs"], "number");

  client.send({ type: "gate.decision", toolCallId: "c1", decision: "approve" });
  assert.equal(await decision, "approve");
});

test("an unanswered approval is denied when it expires", async () => {
  const channel = await startChannel({ gateTimeoutMs: 50 });
  const client = await connect(channel.port, ORIGIN);
  await client.next(); // hello

  const decision = await channel.confirm({
    toolCallId: "c1",
    tool: "run_command",
    action: "exec",
    arguments: {},
    reason: "test"
  });

  assert.equal(decision, "deny", "a gate nobody answers must never approve");
});

test("an approval is denied when the client disappears while it waits", async () => {
  const channel = await startChannel();
  const client = await connect(channel.port, ORIGIN);
  await client.next(); // hello

  const decision = channel.confirm({
    toolCallId: "c1",
    tool: "run_command",
    action: "exec",
    arguments: {},
    reason: "test"
  });

  await client.next(); // gate.request, so the client is demonstrably connected
  client.socket.close();

  assert.equal(await decision, "deny");
});

test("an approval with nobody connected is denied immediately", async () => {
  const channel = await startChannel();
  const started = Date.now();

  const decision = await channel.confirm({
    toolCallId: "c1",
    tool: "run_command",
    action: "exec",
    arguments: {},
    reason: "test"
  });

  assert.equal(decision, "deny");
  assert.ok(Date.now() - started < 1_000, "it must not wait for a client that is not there");
});

test("ignores a malformed decision instead of settling the gate with it", async () => {
  const channel = await startChannel({ gateTimeoutMs: 120 });
  const client = await connect(channel.port, ORIGIN);
  await client.next(); // hello

  const decision = channel.confirm({
    toolCallId: "c1",
    tool: "run_command",
    action: "exec",
    arguments: {},
    reason: "test"
  });

  await client.next(); // gate.request
  client.socket.send("not json");
  client.send({ type: "gate.decision", toolCallId: "c1", decision: "sure" });
  client.send({ type: "gate.decision", toolCallId: "other", decision: "approve" });

  assert.equal(await decision, "deny", "only a real decision for this call settles it");
});
