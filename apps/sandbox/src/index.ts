/**
 * Public surface of the sandbox package.
 *
 * The pieces are re-exported so the agent (and the tests) can build against the
 * same contracts the running server uses, rather than re-declaring them.
 */
export { loadSandboxConfig, type SandboxConfig } from "./config.js";
export {
  ActionError,
  ActionRegistry,
  runAction,
  type ActionContext,
  type ActionKind,
  type ActionOutcome,
  type DirectoryEntry
} from "./actions.js";
export { minimalEnvironment, runCommand, type ExecOptions, type ExecOutcome } from "./exec.js";
export { createSandboxServer, type SandboxServerHandle } from "./server.js";
export {
  WorkspaceEscapeError,
  resolveInsideWorkspace,
  workspaceRelative
} from "./workspace.js";
