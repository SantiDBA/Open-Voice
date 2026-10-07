/**
 * The browser's end of the agent's tool channel.
 *
 * Tool activity and approval requests arrive here on their own WebSocket, next
 * to the conversation socket rather than through it: the agent keeps the tool
 * loop out of the vendored gateway, so the browser keeps the channel out of the
 * conversation protocol.
 *
 * The connection is best-effort. With tools disabled the agent never opens the
 * channel, and a browser that keeps retrying quietly is correct — the UI simply
 * shows no tool activity.
 */

export interface ToolCallEvent {
  type: "tool.call";
  toolCallId: string;
  tool: string;
  action: string;
  arguments: Record<string, unknown>;
  enforcement: "sandbox" | "gate";
  approval: "auto" | "approved";
}

export interface ToolResultEvent {
  type: "tool.result";
  toolCallId: string;
  tool: string;
  outcome: string;
  exitCode?: number | null;
  durationMs?: number;
}

export interface GateRequestEvent {
  type: "gate.request";
  toolCallId: string;
  tool: string;
  action: string;
  arguments: Record<string, unknown>;
  reason: string;
  expiresInMs: number;
}

export interface ToolDeniedEvent {
  type: "tool.denied";
  toolCallId: string;
  reason: string;
}

export interface HelloEvent {
  type: "hello";
  version: number;
  gateTimeoutMs: number;
}

export type ToolChannelEvent =
  | ToolCallEvent
  | ToolResultEvent
  | GateRequestEvent
  | ToolDeniedEvent
  | HelloEvent;

export interface ToolChannelHandlers {
  onEvent(event: ToolChannelEvent): void;
  /** Fired on every transition, so the UI can say whether the channel is live. */
  onStatus(connected: boolean): void;
}

export interface ToolChannelConnection {
  close(): void;
  /** Sends the answer to a pending approval. */
  decide(toolCallId: string, decision: "approve" | "deny"): void;
}

/** How long to wait before retrying a closed channel. */
const RETRY_DELAY_MS = 3_000;

export function connectToolChannel(
  url: string,
  handlers: ToolChannelHandlers
): ToolChannelConnection {
  let socket: WebSocket | null = null;
  let retryTimer: number | null = null;
  let closed = false;

  const open = (): void => {
    if (closed) {
      return;
    }
    let next: WebSocket;
    try {
      next = new WebSocket(url);
    } catch {
      scheduleRetry();
      return;
    }
    socket = next;

    next.addEventListener("open", () => {
      if (closed || socket !== next) return;
      handlers.onStatus(true);
    });

    next.addEventListener("message", (event) => {
      if (closed || socket !== next) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const message = parsed as { type?: unknown };
      if (typeof message.type === "string") {
        handlers.onEvent(parsed as ToolChannelEvent);
      }
    });

    next.addEventListener("close", () => {
      if (socket !== next) return;
      socket = null;
      handlers.onStatus(false);
      // The agent may not be running, or tools may be off. Retrying quietly is
      // the right behaviour in both cases.
      scheduleRetry();
    });

    next.addEventListener("error", () => {
      // `close` follows and handles the retry.
    });
  };

  const scheduleRetry = (): void => {
    if (closed || retryTimer !== null) {
      return;
    }
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      open();
    }, RETRY_DELAY_MS);
  };

  open();

  return {
    close() {
      closed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      socket?.close();
      socket = null;
    },
    decide(toolCallId, decision) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "gate.decision", toolCallId, decision }));
      }
    }
  };
}

/** A one-line description of a tool call, for the activity log. */
export function describeToolCall(tool: string, args: Record<string, unknown>): string {
  const path = typeof args["path"] === "string" ? args["path"] : "";
  switch (tool) {
    case "run_command": {
      const command = typeof args["command"] === "string" ? args["command"] : "";
      return `run_command · ${truncate(command, 90)}`;
    }
    case "write_file": {
      const content = typeof args["content"] === "string" ? args["content"] : "";
      return `write_file · ${path} · ${content.length} chars`;
    }
    case "edit_file": {
      const find = typeof args["find"] === "string" ? args["find"] : "";
      return `edit_file · ${path} · replacing ${truncate(JSON.stringify(find), 40)}`;
    }
    case "read_file":
      return `read_file · ${path}`;
    case "list_dir":
      return `list_dir · ${path || "."}`;
    case "host_exec": {
      const command = typeof args["command"] === "string" ? args["command"] : "";
      return `host_exec · ${truncate(command, 90)}`;
    }
    case "host_file_read":
      return `host_file_read · ${path}`;
    case "host_file_write": {
      const content = typeof args["content"] === "string" ? args["content"] : "";
      return `host_file_write · ${path} · ${content.length} chars`;
    }
    case "host_browse": {
      const url = typeof args["url"] === "string" ? args["url"] : "";
      return `host_browse · ${truncate(url, 90)}`;
    }
    default:
      return `${tool} · ${truncate(JSON.stringify(args), 90)}`;
  }
}

/** The exact thing the user is approving, shown in the gate. */
export function describeGateAction(args: Record<string, unknown>): string {
  if (typeof args["command"] === "string") {
    return args["command"];
  }
  if (typeof args["url"] === "string") {
    return args["url"];
  }
  if (typeof args["domain"] === "string") {
    return `Add ${args["domain"]} to the egress allowlist`;
  }
  return JSON.stringify(args, null, 2);
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
