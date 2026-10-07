import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";

import { ActionError, ActionRegistry, runAction } from "./actions.js";
import type { SandboxConfig } from "./config.js";

export interface SandboxServerHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * The sandbox's HTTP surface.
 *
 * Every route except `/healthz` requires the bearer token, compared in constant
 * time. The action API runs arbitrary commands inside the workspace, so an
 * unauthenticated request must never reach `runAction` — including from another
 * process on the same machine.
 */
export async function createSandboxServer(
  config: SandboxConfig
): Promise<SandboxServerHandle> {
  const registry = new ActionRegistry();

  const server = createServer((request, response) => {
    void handleRequest(request, response, config, registry).catch((error) => {
      log("sandbox.request_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false, code: "internal", error: "internal error" });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Sandbox server did not bind to a TCP port");
  }

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: SandboxConfig,
  registry: ActionRegistry
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://sandbox");

  // Liveness is intentionally unauthenticated so a container healthcheck needs
  // no secret; it reports nothing about the workspace or what ran.
  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, {
      status: "ok",
      service: "open-voice-sandbox",
      runningActions: registry.size
    });
    return;
  }

  if (!isAuthorized(request, config.token)) {
    sendJson(response, 401, { ok: false, code: "unauthorized", error: "unauthorized" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/actions") {
    await handleCreateAction(request, response, config, registry);
    return;
  }

  const cancelMatch = /^\/actions\/([^/]+)\/cancel$/.exec(url.pathname);
  if (request.method === "POST" && cancelMatch) {
    const cancelled = registry.cancel(decodeURIComponent(cancelMatch[1]!));
    sendJson(response, 200, { ok: true, cancelled });
    return;
  }

  sendJson(response, 404, { ok: false, code: "not_found", error: "not found" });
}

async function handleCreateAction(
  request: IncomingMessage,
  response: ServerResponse,
  config: SandboxConfig,
  registry: ActionRegistry
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(request, config.maxRequestBytes);
  } catch (error) {
    const tooLarge = error instanceof RequestTooLargeError;
    sendJson(response, tooLarge ? 413 : 400, {
      ok: false,
      code: tooLarge ? "request_too_large" : "invalid_json",
      error: tooLarge ? "request body is too large" : "request body is not valid JSON"
    });
    return;
  }

  const actionId = resolveActionId(body);
  if (actionId === null) {
    sendJson(response, 400, {
      ok: false,
      code: "invalid_request",
      error: "actionId must be 1-128 characters of [A-Za-z0-9._-]"
    });
    return;
  }
  const controller = registry.begin(actionId);
  try {
    const outcome = await runAction(body, {
      workspace: config.workspace,
      maxOutputBytes: config.maxOutputBytes,
      actionTimeoutMs: config.actionTimeoutMs,
      signal: controller.signal
    });
    sendJson(response, 200, { ok: true, actionId, ...outcome });
  } catch (error) {
    if (error instanceof ActionError) {
      sendJson(response, statusForError(error.code), {
        ok: false,
        actionId,
        code: error.code,
        error: error.message
      });
      return;
    }
    log("sandbox.action_failed", {
      actionId,
      error: error instanceof Error ? error.message : String(error)
    });
    sendJson(response, 500, { ok: false, actionId, code: "internal", error: "internal error" });
  } finally {
    registry.end(actionId);
  }
}

function statusForError(code: ActionError["code"]): number {
  switch (code) {
    case "workspace_escape":
      // A path that leaves the workspace is a policy rejection, not a typo.
      return 403;
    case "not_found":
      return 404;
    case "not_a_directory":
    case "invalid_request":
      return 400;
  }
}

class RequestTooLargeError extends Error {}

/**
 * The id an action runs under.
 *
 * The caller may supply its own, and it must: `POST /actions` answers only when
 * the action has finished, so an id the server minted at the end could never be
 * used to cancel a run that is still going. The agent mints one per tool call
 * and can then cancel it by id. A missing id falls back to a generated one, for
 * callers that never need to cancel.
 */
function resolveActionId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return randomUUID();
  }
  const candidate = (body as Record<string, unknown>)["actionId"];
  if (candidate === undefined) {
    return randomUUID();
  }
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > 128 ||
    !/^[A-Za-z0-9._-]+$/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function readJsonBody(
  request: IncomingMessage,
  maxBytes: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new RequestTooLargeError("request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (chunks.length === 0) {
        reject(new Error("empty body"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

/** Constant-time bearer comparison, so a wrong token leaks no timing signal. */
function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }
  const presented = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  if (presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(presented, expected);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store"
  });
  response.end(payload);
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event, ...fields })}\n`
  );
}
