import fs from "node:fs/promises";
import path from "node:path";

import { runCommand } from "./exec.js";
import {
  WorkspaceEscapeError,
  resolveInsideWorkspace,
  workspaceRelative
} from "./workspace.js";

/** The actions the sandbox can perform. Everything else is rejected. */
export type ActionKind =
  | "exec"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "list_dir";

/**
 * A request-level failure: malformed input, an escape attempt, a missing file.
 * These map to HTTP 4xx. A command that merely failed is *not* one of these —
 * it is a normal result the caller must see.
 */
export class ActionError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "workspace_escape"
      | "not_found"
      | "not_a_directory",
    message: string
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export interface ActionContext {
  workspace: string;
  maxOutputBytes: number;
  actionTimeoutMs: number;
  signal: AbortSignal;
}

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory" | "other";
  size?: number;
}

export interface ActionOutcome {
  status: "ok" | "error" | "timeout" | "cancelled";
  kind: ActionKind;
  /** Workspace-relative path the action touched, when it touched one. */
  path?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
  durationMs?: number;
  content?: string;
  bytes?: number;
  replacements?: number;
  entries?: DirectoryEntry[];
  entriesTruncated?: boolean;
}

/** The most entries `list_dir` returns in one call. */
const MAX_DIRECTORY_ENTRIES = 1_000;

/**
 * Tracks the actions that are running so one can be cancelled by id. A cancel
 * aborts the action's signal, which is what kills a command's process group.
 */
export class ActionRegistry {
  private readonly running = new Map<string, AbortController>();

  begin(actionId: string): AbortController {
    const controller = new AbortController();
    this.running.set(actionId, controller);
    return controller;
  }

  cancel(actionId: string): boolean {
    const controller = this.running.get(actionId);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  end(actionId: string): void {
    this.running.delete(actionId);
  }

  get size(): number {
    return this.running.size;
  }
}

/**
 * Runs one action and normalizes the result. Throws `ActionError` for a
 * malformed or escaping request; returns a described outcome for everything
 * else, including a command that failed, timed out or was cancelled.
 */
export async function runAction(
  input: unknown,
  context: ActionContext
): Promise<ActionOutcome> {
  if (typeof input !== "object" || input === null) {
    throw new ActionError("invalid_request", "a JSON object body is required");
  }
  const request = input as Record<string, unknown>;
  const kind = request["kind"];
  if (typeof kind !== "string" || !isActionKind(kind)) {
    throw new ActionError(
      "invalid_request",
      "kind must be one of: exec, read_file, write_file, edit_file, list_dir"
    );
  }

  switch (kind) {
    case "exec":
      return runExec(request, context);
    case "read_file":
      return runReadFile(request, context);
    case "write_file":
      return runWriteFile(request, context);
    case "edit_file":
      return runEditFile(request, context);
    case "list_dir":
      return runListDir(request, context);
  }
}

function isActionKind(value: string): value is ActionKind {
  return (
    value === "exec" ||
    value === "read_file" ||
    value === "write_file" ||
    value === "edit_file" ||
    value === "list_dir"
  );
}

async function runExec(
  request: Record<string, unknown>,
  context: ActionContext
): Promise<ActionOutcome> {
  const command = request["command"];
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new ActionError("invalid_request", "command must be a non-empty string");
  }

  const directory = resolvePath(context, request["cwd"] ?? ".");
  const timeoutMs = resolveTimeout(request["timeoutMs"], context);

  const outcome = await runCommand({
    command,
    cwd: directory,
    timeoutMs,
    maxOutputBytes: context.maxOutputBytes,
    signal: context.signal
  });

  return {
    status: outcome.cancelled
      ? "cancelled"
      : outcome.timedOut
        ? "timeout"
        : outcome.exitCode === 0
          ? "ok"
          : "error",
    kind: "exec",
    path: workspaceRelative(context.workspace, directory),
    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    truncated: outcome.truncated,
    durationMs: outcome.durationMs
  };
}

async function runReadFile(
  request: Record<string, unknown>,
  context: ActionContext
): Promise<ActionOutcome> {
  const target = resolvePath(context, request["path"]);
  const limit = context.maxOutputBytes;

  let handle;
  try {
    handle = await fs.open(target, "r");
  } catch {
    throw new ActionError(
      "not_found",
      `cannot read: ${workspaceRelative(context.workspace, target)}`
    );
  }

  try {
    const stat = await handle.stat();
    if (stat.isDirectory()) {
      throw new ActionError(
        "not_a_directory",
        `not a file: ${workspaceRelative(context.workspace, target)}`
      );
    }
    const size = Math.min(stat.size, limit);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return {
      status: "ok",
      kind: "read_file",
      path: workspaceRelative(context.workspace, target),
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      bytes: bytesRead,
      truncated: stat.size > limit
    };
  } finally {
    await handle.close();
  }
}

async function runWriteFile(
  request: Record<string, unknown>,
  context: ActionContext
): Promise<ActionOutcome> {
  const content = request["content"];
  if (typeof content !== "string") {
    throw new ActionError("invalid_request", "content must be a string");
  }
  const target = resolvePath(context, request["path"]);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return {
    status: "ok",
    kind: "write_file",
    path: workspaceRelative(context.workspace, target),
    bytes: Buffer.byteLength(content, "utf8")
  };
}

async function runEditFile(
  request: Record<string, unknown>,
  context: ActionContext
): Promise<ActionOutcome> {
  const find = request["find"];
  const replace = request["replace"];
  if (typeof find !== "string" || find.length === 0) {
    throw new ActionError("invalid_request", "find must be a non-empty string");
  }
  if (typeof replace !== "string") {
    throw new ActionError("invalid_request", "replace must be a string");
  }
  const replaceAll = request["all"] === true;
  const target = resolvePath(context, request["path"]);

  let current: string;
  try {
    current = await fs.readFile(target, "utf8");
  } catch {
    throw new ActionError(
      "not_found",
      `cannot read: ${workspaceRelative(context.workspace, target)}`
    );
  }

  const occurrences = current.split(find).length - 1;
  if (occurrences > 0) {
    const next = replaceAll
      ? current.split(find).join(replace)
      : current.replace(find, replace);
    await fs.writeFile(target, next, "utf8");
  }

  return {
    status: "ok",
    kind: "edit_file",
    path: workspaceRelative(context.workspace, target),
    replacements: replaceAll ? occurrences : Math.min(occurrences, 1)
  };
}

async function runListDir(
  request: Record<string, unknown>,
  context: ActionContext
): Promise<ActionOutcome> {
  const directory = resolvePath(context, request["path"] ?? ".");

  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    throw new ActionError(
      "not_found",
      `cannot list: ${workspaceRelative(context.workspace, directory)}`
    );
  }

  const sorted = entries
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_DIRECTORY_ENTRIES);

  const described: DirectoryEntry[] = await Promise.all(
    sorted.map(async (entry): Promise<DirectoryEntry> => {
      if (entry.isDirectory()) {
        return { name: entry.name, type: "directory" };
      }
      if (!entry.isFile()) {
        return { name: entry.name, type: "other" };
      }
      try {
        const stat = await fs.stat(path.join(directory, entry.name));
        return { name: entry.name, type: "file", size: stat.size };
      } catch {
        return { name: entry.name, type: "file" };
      }
    })
  );

  return {
    status: "ok",
    kind: "list_dir",
    path: workspaceRelative(context.workspace, directory),
    entries: described,
    entriesTruncated: entries.length > MAX_DIRECTORY_ENTRIES
  };
}

/** Resolves a request path inside the workspace, translating the escape error. */
function resolvePath(context: ActionContext, value: unknown): string {
  try {
    return resolveInsideWorkspace(context.workspace, value);
  } catch (error) {
    if (error instanceof WorkspaceEscapeError) {
      throw new ActionError("workspace_escape", error.message);
    }
    throw error;
  }
}

function resolveTimeout(value: unknown, context: ActionContext): number {
  if (value === undefined) {
    return context.actionTimeoutMs;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100) {
    throw new ActionError(
      "invalid_request",
      "timeoutMs must be an integer of at least 100"
    );
  }
  // A caller may shorten its own action but never outlive the configured cap.
  return Math.min(value, context.actionTimeoutMs);
}
