import { WebSocketServer, type WebSocket } from "ws";

import type {
  GateDecision,
  GateRequest,
  ToolCallNotice,
  ToolReporter,
  ToolResultNotice
} from "./tools/reporter.js";

/**
 * The agent's channel to the browser for tool activity and approvals.
 *
 * It is a second server on its own port rather than a route on the gateway's:
 * the vendored gateway owns its HTTP server and its WebSocket server accepts
 * every upgrade, so carving a path out of it would mean fighting it. A separate
 * listener leaves both sides of that boundary alone.
 *
 * Two properties matter:
 *
 * - **Origin-checked, fail-closed.** A browser will happily open a WebSocket to
 *   a localhost port from any page; without an Origin check, a random tab could
 *   watch the agent work and, later, approve its actions. No allowed origins
 *   configured means no connections at all.
 * - **An unanswered gate is a denial.** Nothing here can resolve `approve` on
 *   its own: a timeout, a disconnect or an absent client all deny.
 */

export interface ToolChannelLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
}

export interface ToolChannelOptions {
  host: string;
  port: number;
  allowedOrigins: string[];
  logger: ToolChannelLogger;
  gateTimeoutMs?: number;
}

export interface ToolChannel extends ToolReporter {
  readonly port: number;
  readonly clients: number;
  close(): Promise<void>;
}

/** How long a pending approval waits before it is denied. */
export const DEFAULT_GATE_TIMEOUT_MS = 60_000;

export async function createToolChannel(
  options: ToolChannelOptions
): Promise<ToolChannel> {
  const gateTimeoutMs = options.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
  const allowed = new Set(options.allowedOrigins);
  const sockets = new Set<WebSocket>();
  const pending = new Map<
    string,
    { resolve: (decision: GateDecision) => void; timer: NodeJS.Timeout }
  >();

  const server = new WebSocketServer({
    host: options.host,
    port: options.port,
    verifyClient: ({ origin }, done) => {
      if (allowed.size === 0) {
        options.logger.warn("tool_channel.refused", {
          reason: "no allowed origins configured",
          origin: origin ?? null
        });
        done(false, 403, "Origin is not allowed");
        return;
      }
      if (typeof origin === "string" && allowed.has(origin)) {
        done(true);
        return;
      }
      options.logger.warn("tool_channel.refused", { origin: origin ?? null });
      done(false, 403, "Origin is not allowed");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const broadcast = (event: Record<string, unknown>): void => {
    const payload = JSON.stringify(event);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  };

  const settle = (toolCallId: string, decision: GateDecision): void => {
    const entry = pending.get(toolCallId);
    if (!entry) {
      return;
    }
    pending.delete(toolCallId);
    clearTimeout(entry.timer);
    entry.resolve(decision);
  };

  server.on("connection", (socket) => {
    sockets.add(socket);
    options.logger.info("tool_channel.connected", { clients: sockets.size });
    socket.send(JSON.stringify({ type: "hello", version: 1, gateTimeoutMs }));

    socket.on("message", (raw) => {
      const message = parseIncoming(String(raw));
      if (!message) {
        return;
      }
      if (message.type === "gate.decision") {
        options.logger.info("tool_channel.decision", {
          toolCallId: message.toolCallId,
          decision: message.decision
        });
        settle(message.toolCallId, message.decision);
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
      options.logger.info("tool_channel.disconnected", { clients: sockets.size });
      // A disconnect cannot silently leave an action waiting for approval it
      // will never get.
      for (const toolCallId of [...pending.keys()]) {
        settle(toolCallId, "deny");
      }
    });

    socket.on("error", () => socket.terminate());
  });

  const address = server.address();
  const port =
    address !== null && typeof address === "object" ? address.port : options.port;

  options.logger.info("tool_channel.listening", {
    host: options.host,
    port,
    allowedOrigins: options.allowedOrigins
  });

  return {
    port,
    get clients() {
      return sockets.size;
    },

    call(notice: ToolCallNotice) {
      broadcast({ type: "tool.call", ...notice });
    },

    result(notice: ToolResultNotice) {
      broadcast({ type: "tool.result", ...notice });
    },

    confirm(request: GateRequest): Promise<GateDecision> {
      if (sockets.size === 0) {
        // Nobody can answer, so the answer is no. Saying so out loud beats
        // waiting a minute for a decision that cannot arrive.
        options.logger.warn("tool_channel.no_client", { toolCallId: request.toolCallId });
        broadcast({ type: "tool.denied", toolCallId: request.toolCallId, reason: "no client connected" });
        return Promise.resolve("deny");
      }

      return new Promise<GateDecision>((resolve) => {
        const timer = setTimeout(() => {
          settle(request.toolCallId, "deny");
        }, gateTimeoutMs);
        pending.set(request.toolCallId, { resolve, timer });
        broadcast({ type: "gate.request", ...request, expiresInMs: gateTimeoutMs });
      });
    },

    async close() {
      for (const toolCallId of [...pending.keys()]) {
        settle(toolCallId, "deny");
      }
      for (const socket of sockets) {
        socket.terminate();
      }
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

/** Validates a message from the browser. Unknown shapes are ignored. */
function parseIncoming(raw: string):
  | { type: "gate.decision"; toolCallId: string; decision: GateDecision }
  | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const message = parsed as Record<string, unknown>;
  if (message["type"] !== "gate.decision") {
    return null;
  }
  const toolCallId = message["toolCallId"];
  const decision = message["decision"];
  if (typeof toolCallId !== "string" || toolCallId.length === 0) {
    return null;
  }
  if (decision !== "approve" && decision !== "deny") {
    return null;
  }
  return { type: "gate.decision", toolCallId, decision };
}
