import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "vitest";

import { createHostExecutor } from "./server.js";
import type { HostExecutorConfig } from "./config.js";

interface ServerHandle {
  url: string;
  close: () => Promise<void>;
}

async function startExecutor(overrides: Partial<HostExecutorConfig> = {}): Promise<ServerHandle> {
  const root = await mkdtemp(join(tmpdir(), "host-exec-test-"));
  await mkdir(join(root, "sub"), { recursive: true });
  await writeFile(join(root, "hello.txt"), "hola mundo\n");

  const config: HostExecutorConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    root,
    allowedCommands: ["echo *"],
    timeoutMs: 5_000,
    maxOutputBytes: 64_000,
    dryRun: true,
    egressAllowlist: ["*.duckduckgo.com"],
    ...overrides
  };

  const handle = await createHostExecutor(config);
  return {
    url: `http://127.0.0.1:${handle.port}`,
    close: () => handle.close()
  };
}

async function post(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
}

async function get(url: string): Promise<Response> {
  return fetch(url);
}

const handles: ServerHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.close();
  }
});

describe("healthz", () => {
  test("unauthenticated liveness probe answers 200", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await get(`${server.url}/healthz`);
    assert.equal(response.ok, true);
    const body = await response.json();
    assert.equal(body.service, "open-voice-host-executor");
  });
});

describe("authentication", () => {
  test("refuses a request with no token", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "wrong", { kind: "exec", command: "echo hi" });
    assert.equal(response.status, 401);
  });
});

describe("exec", () => {
  test("runs an allowed command", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "exec",
      command: "echo hola",
      actionId: "test-1"
    });
    assert.equal(response.ok, true);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.kind, "exec");
    assert.equal(body.status, "ok");
    assert.equal(body.exitCode, 0);
    assert.equal(body.stdout, "hola\n");
  });

  test("refuses a command not on the allowlist", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "exec",
      command: "rm -rf /"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 403);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.code, "not_allowed");
  });

  test("refuses a compound command", async () => {
    const server = await startExecutor({ allowedCommands: ["*"] });
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "exec",
      command: "echo hi && rm -rf /"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 403);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.code, "compound_command");
  });
});

describe("read_file", () => {
  test("reads a file inside the root", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "read_file",
      path: "hello.txt",
      actionId: "read-1"
    });
    assert.equal(response.ok, true);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.kind, "read_file");
    assert.equal(body.status, "ok");
    assert.equal(body.content, "hola mundo\n");
    assert.equal(body.bytes, 11);
    assert.equal(body.truncated, false);
  });

  test("refuses a path that escapes the root", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "read_file",
      path: "../../../etc/passwd"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 403);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.code, "path_escape");
  });

  test("refuses reading a directory", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "read_file",
      path: "sub"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
  });

  test("refuses reading a non-existent file", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "read_file",
      path: "nope.txt"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
  });
});

describe("write_file", () => {
  test("writes a file inside the root", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "write_file",
      path: "written.txt",
      content: "written content",
      actionId: "write-1"
    });
    assert.equal(response.ok, true);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.kind, "write_file");
    assert.equal(body.status, "ok");
    assert.equal(body.bytes, 15);
  });

  test("refuses a path that escapes the root", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "write_file",
      path: "../escape.txt",
      content: "evil"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 403);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.code, "path_escape");
  });
});

describe("browse", () => {
  test("refuses a non-https URL", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "browse",
      url: "http://example.com"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
  });

  test("refuses an invalid URL", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "browse",
      url: "not-a-url"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
  });

  test("refuses localhost (SSRF protection)", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "browse",
      url: "https://localhost/"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
    const body = await response.json() as Record<string, unknown>;
    assert.ok(String(body.error).includes("SSRF"), `expected SSRF in error, got: ${body.error}`);
  });

  test("refuses the cloud metadata endpoint", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "browse",
      url: "https://169.254.169.254/latest/meta-data/"
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
  });
});

describe("search", () => {
  test("refuses search when egress allowlist is empty (deny-by-default)", async () => {
    const server = await startExecutor({ egressAllowlist: [] });
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "search",
      query: "test"
    });
    assert.equal(response.ok, false);
    const body = await response.json() as Record<string, unknown>;
    assert.ok(String(body.error).includes("egress allowlist"));
  });

  test("refuses search for a query that is not a string", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "test-token", {
      kind: "search",
      query: 123
    });
    assert.equal(response.ok, false);
  });

  test("returns no auth for a missing token", async () => {
    const server = await startExecutor();
    handles.push(server);
    const response = await post(`${server.url}/exec`, "", {
      kind: "search",
      query: "test"
    });
    assert.equal(response.status, 401);
  });
});
