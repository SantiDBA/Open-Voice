/**
 * The tool audit trail.
 *
 * Every tool call is recorded with what was asked, what ran and what came back.
 * It writes to the process log (structured JSON, one line per entry) rather than
 * to a file inside the container on purpose: the agent container has no mounted
 * volume, so a file there would be destroyed on every recreate while looking
 * durable. The log is captured by Docker and readable with `docker compose logs
 * agent`. A durable file belongs with a mounted volume and a retention decision,
 * not with a path chosen here.
 */

export interface ToolAuditEntry {
  toolCallId: string;
  tool: string;
  action: string;
  /** The arguments the model asked for, as it asked for them. */
  arguments: unknown;
  /** `ok` | `error` | `timeout` | `cancelled` | `refused`. */
  outcome: string;
  exitCode?: number | null;
  durationMs?: number;
  /** A short human note: the refusal reason, or the first line of an error. */
  detail?: string;
}

export interface ToolAudit {
  record(entry: ToolAuditEntry): void;
}

/** The part of the gateway logger the audit needs. */
export interface AuditSink {
  info(event: string, fields?: Record<string, unknown>): void;
}

export function createToolAudit(sink: AuditSink): ToolAudit {
  return {
    record(entry) {
      sink.info("tool.audit", { ...entry });
    }
  };
}

/** A no-op audit, for tests and for when tools are disabled. */
export const NOOP_TOOL_AUDIT: ToolAudit = { record: () => undefined };
