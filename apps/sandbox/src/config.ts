/**
 * Configuration for the sandbox action server.
 *
 * The sandbox is the execution boundary: it runs commands and touches files
 * inside one directory and nowhere else. Every value here is read once at
 * startup and fails fast, because a sandbox that starts with a wrong root or
 * with no token is worse than one that refuses to start.
 */

/** Upper bound used by the timeout knobs, which only have a meaningful floor. */
const INT32_MAX = 2_147_483_647;

/** 8 MiB. A JSON request carries a whole file for `write_file`. */
const DEFAULT_MAX_REQUEST_BYTES = 8 * 1024 * 1024;

/** 256 KiB. Output past this is truncated, not buffered unbounded. */
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

export interface SandboxConfig {
  /**
   * Interface to bind. Defaults to loopback so a bare `pnpm dev` never exposes
   * the action API to the network. Inside the container this is set to
   * `0.0.0.0` and the loopback restriction is carried by the compose port
   * mapping (`127.0.0.1:<port>:<port>`), exactly as Speaches does.
   */
  host: string;
  port: number;
  /** Bearer token every request must present. Required: no default. */
  token: string;
  /** The one directory actions may read, write and execute inside. */
  workspace: string;
  /** Output bytes kept per stream before the rest is dropped. */
  maxOutputBytes: number;
  /** Wall-clock ceiling for one action. */
  actionTimeoutMs: number;
  /** Ceiling for a JSON request body. */
  maxRequestBytes: number;
}

export function loadSandboxConfig(
  env: NodeJS.ProcessEnv = process.env
): SandboxConfig {
  const token = nonEmpty(env.SANDBOX_TOKEN);
  if (!token) {
    throw new Error(
      "SANDBOX_TOKEN is required: the action API runs commands and must never be reachable without a credential"
    );
  }

  return {
    host: nonEmpty(env.SANDBOX_HOST) ?? "127.0.0.1",
    port: parseInteger(env.SANDBOX_PORT, 8790, "SANDBOX_PORT", 1, 65_535),
    token,
    workspace: nonEmpty(env.SANDBOX_WORKSPACE) ?? "/workspace",
    maxOutputBytes: parseInteger(
      env.SANDBOX_MAX_OUTPUT_BYTES,
      DEFAULT_MAX_OUTPUT_BYTES,
      "SANDBOX_MAX_OUTPUT_BYTES",
      1_024,
      INT32_MAX
    ),
    actionTimeoutMs: parseInteger(
      env.SANDBOX_ACTION_TIMEOUT_MS,
      120_000,
      "SANDBOX_ACTION_TIMEOUT_MS",
      1_000,
      INT32_MAX
    ),
    maxRequestBytes: parseInteger(
      env.SANDBOX_MAX_REQUEST_BYTES,
      DEFAULT_MAX_REQUEST_BYTES,
      "SANDBOX_MAX_REQUEST_BYTES",
      1_024,
      INT32_MAX
    )
  };
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number
): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
