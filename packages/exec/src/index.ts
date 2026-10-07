import { spawn, type ChildProcess } from "node:child_process";

export {
  WorkspaceEscapeError,
  relativeTo,
  resolveInside
} from "./paths.js";

/**
 * Running one command, once, with the three things that are easy to get wrong:
 * output that cannot exhaust memory, a timeout that actually ends it, and a kill
 * that reaches the whole process tree rather than the shell in front of it.
 *
 * Shared by the sandbox and the host executor because both need exactly this,
 * and two copies of a security-relevant kill path is two places to get it
 * wrong. They differ only in which environment variables the command inherits.
 */

export interface ExecOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

export interface ExecOptions {
  command: string;
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
  /**
   * Which of the parent's variables the command may inherit. Everything else is
   * absent by construction — a token in the server's environment must not reach
   * an arbitrary command, and an allowlist cannot be defeated by a variable
   * nobody thought to deny.
   */
  envKeys?: readonly string[];
  /** The environment to filter. Defaults to this process's. */
  env?: NodeJS.ProcessEnv;
}

/** The variables an ordinary unix tool needs, and nothing else. */
export const DEFAULT_ENV_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "TERM",
  "USER",
  "SHELL"
] as const;

export function minimalEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  keys: readonly string[] = DEFAULT_ENV_KEYS
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // Without a PATH the shell cannot find anything; a fixed fallback keeps a
  // stripped environment usable instead of mysteriously broken.
  env["PATH"] ??= "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  return env;
}

export function runCommand(options: ExecOptions): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(options.command, {
      cwd: options.cwd,
      env: minimalEnvironment(options.env, options.envKeys),
      shell: true,
      // Its own process group: `process.kill(-pid)` then reaches every
      // descendant, including the `sh -c` wrapper's children.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let captured = 0;
    let truncated = false;
    let settled = false;
    let timedOut = false;
    let cancelled = false;

    const capture = (chunk: Buffer, stream: "out" | "err"): void => {
      if (captured >= options.maxOutputBytes) {
        truncated = true;
        return;
      }
      const remaining = options.maxOutputBytes - captured;
      const text =
        chunk.length > remaining
          ? chunk.subarray(0, remaining).toString("utf8")
          : chunk.toString("utf8");
      if (chunk.length > remaining) {
        truncated = true;
      }
      captured += Math.min(chunk.length, remaining);
      if (stream === "out") {
        stdout += text;
      } else {
        stderr += text;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => capture(chunk, "out"));
    child.stderr?.on("data", (chunk: Buffer) => capture(chunk, "err"));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGKILL");
    }, options.timeoutMs);

    const onAbort = (): void => {
      cancelled = true;
      killTree(child, "SIGKILL");
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      resolve({
        exitCode,
        stdout,
        stderr,
        truncated,
        timedOut,
        cancelled,
        durationMs: Date.now() - startedAt
      });
    };

    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

/**
 * Kills the command's whole process group. Falls back to the single process
 * when the group is already gone, and never throws: the caller is usually
 * already handling a failure.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already dead; nothing left to kill.
    }
  }
}
