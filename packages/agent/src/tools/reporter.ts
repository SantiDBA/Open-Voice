/**
 * How the tool loop tells the outside world what it is doing, and asks for
 * permission before it does something the user should decide.
 *
 * The loop depends on this interface, not on the channel: with no browser
 * connected, or with tools disabled, a no-op implementation keeps the loop
 * working and answers "deny" to anything that needs approval. Fail-closed, not
 * fail-open.
 */

import type { Enforcement } from "./registry.js";

export interface ToolCallNotice {
  toolCallId: string;
  tool: string;
  action: string;
  arguments: unknown;
  enforcement: Enforcement;
  /** Whether this call was allowed to run on its own, or after an approval. */
  approval: "auto" | "approved";
}

export interface ToolResultNotice {
  toolCallId: string;
  tool: string;
  /** `ok` | `error` | `timeout` | `cancelled` | `denied` | `refused`. */
  outcome: string;
  exitCode?: number | null;
  durationMs?: number;
}

export interface GateRequest {
  toolCallId: string;
  tool: string;
  action: string;
  arguments: unknown;
  /** Why this action needs a decision, in words the user will read. */
  reason: string;
}

export type GateDecision = "approve" | "deny";

export interface ToolReporter {
  /** About to run. Sent after any approval, so it means "this is happening". */
  call(notice: ToolCallNotice): void;
  /** Finished, with how it went. */
  result(notice: ToolResultNotice): void;
  /**
   * Asks the user. Must never resolve `approve` without a human decision: an
   * unanswered request, a timeout or a missing client all mean deny.
   */
  confirm(request: GateRequest): Promise<GateDecision>;
}

/** Used when there is nobody to tell: the loop runs, gates deny. */
export const NOOP_REPORTER: ToolReporter = {
  call: () => undefined,
  result: () => undefined,
  confirm: async () => "deny"
};
