import fs from "node:fs";
import path from "node:path";

/**
 * Keeping a path inside a directory, safely.
 *
 * Both executors need this: the sandbox keeps commands inside `/workspace`, and
 * the host executor keeps working directories inside the root it was given. One
 * implementation, because a second one is a second chance to miss the symlink.
 */

export class WorkspaceEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceEscapeError";
  }
}

/**
 * Resolves `input` (relative to the root, or absolute) to an absolute path that
 * is provably inside `root`, or throws.
 *
 * Two checks, both required:
 *
 * 1. **Lexical containment** — after `path.resolve`, the path relative to the
 *    root must not start with `..` and must not be absolute. Not enough alone,
 *    because a symlink inside the root can point anywhere.
 * 2. **Symlink resolution** — the deepest *existing* ancestor of the candidate
 *    is `realpath`-ed, so a symlink pointing outside resolves to its target
 *    before containment is re-checked. A path that does not exist yet (a new
 *    file) is resolved through its nearest existing ancestor, so creating files
 *    still works.
 *
 * The returned path is the resolved one, so callers act on the same path that
 * was validated rather than re-following a symlink.
 */
export function resolveInside(root: string, input: unknown): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new WorkspaceEscapeError("a path is required");
  }
  if (input.includes("\0")) {
    throw new WorkspaceEscapeError("a path may not contain a NUL byte");
  }

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    throw new WorkspaceEscapeError(`the root does not exist: ${root}`);
  }

  const candidate = path.resolve(realRoot, input);
  const resolved = resolveSymlinks(candidate);
  const relative = path.relative(realRoot, resolved);

  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new WorkspaceEscapeError(`path escapes the root: ${input}`);
  }

  return resolved;
}

/** The root-relative form of a resolved path, for logs and audit lines. */
export function relativeTo(root: string, absolute: string): string {
  const relative = path.relative(root, absolute);
  return relative === "" ? "." : relative;
}

function resolveSymlinks(absolute: string): string {
  let current = absolute;
  const missing: string[] = [];

  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return missing.length === 0 ? real : path.join(real, ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new WorkspaceEscapeError(`cannot resolve ${absolute}`);
      }
      // Prepending while walking up keeps the suffix shallow-to-deep.
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}
