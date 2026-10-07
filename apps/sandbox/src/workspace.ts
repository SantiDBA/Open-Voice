import {
  WorkspaceEscapeError,
  relativeTo,
  resolveInside
} from "@open-voice/exec";

/**
 * The sandbox's view of path confinement.
 *
 * The resolver lives in `@open-voice/exec` because the host executor needs the
 * same guarantee; this file only names it the way the sandbox talks about it.
 */
export { WorkspaceEscapeError };

/** Resolves a request path inside the sandbox workspace, or throws. */
export function resolveInsideWorkspace(root: string, input: unknown): string {
  return resolveInside(root, input);
}

/** The workspace-relative form of a resolved path, for logs and audit lines. */
export function workspaceRelative(root: string, absolute: string): string {
  return relativeTo(root, absolute);
}
