/**
 * Configuration for the host executor.
 *
 * This process runs commands on the operator's machine, outside every
 * container. It has no default that makes it powerful: it refuses to start
 * without a token, it runs nothing unless a command is explicitly allowed, and
 * it confines working directories to one root.
 */
export interface HostExecutorConfig {
  host: string;
  port: number;
  /** Bearer token the agent must present. Required: no default. */
  token: string;
  /** Working directories must live inside this root. */
  root: string;
  /** Command patterns that may run. Empty means nothing may. */
  allowedCommands: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  /**
   * Run commands in the container namespace instead of over SSH.
   * When true, HOST_EXECUTOR_HOST is ignored: the operator can exercise the
   * full flow (allowlist, approval gate, audit log) without granting real host
   * access. Defaults to ON so pointing at a host executor does not silently
   * hand over the machine.
   */
  dryRun: boolean;
  /** Domains the browse and search tools may fetch. Empty means no browsing or searching at all. */
  egressAllowlist: string[];
  /**
   * The browserbot service URL, when one is configured. When set, the
   * host_interact tool is proxied through this executor to the browserbot.
   * When absent, host_interact is refused with an actionable error.
   */
  browserbotBaseUrl?: string;
}

export function loadHostExecutorConfig(
  env: NodeJS.ProcessEnv = process.env
): HostExecutorConfig {
  const token = nonEmpty(env.HOST_EXECUTOR_TOKEN);
  if (!token) {
    throw new Error(
      "HOST_EXECUTOR_TOKEN is required: this process runs commands on your machine and must never be reachable without a credential"
    );
  }

  return {
    // Loopback by default. This is the one process whose reach is the whole
    // machine, so it is the one that should never listen anywhere else.
    host: nonEmpty(env.HOST_EXECUTOR_HOST) ?? "127.0.0.1",
    port: parseInteger(env.HOST_EXECUTOR_PORT, 8791, "HOST_EXECUTOR_PORT", 1, 65_535),
    token,
    root: nonEmpty(env.HOST_EXECUTOR_ROOT) ?? process.cwd(),
    allowedCommands: (env.HOST_EXECUTOR_ALLOWED_COMMANDS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    timeoutMs: parseInteger(
      env.HOST_EXECUTOR_TIMEOUT_MS,
      120_000,
      "HOST_EXECUTOR_TIMEOUT_MS",
      1_000,
      2_147_483_647
    ),
       maxOutputBytes: parseInteger(
      env.HOST_EXECUTOR_MAX_OUTPUT_BYTES,
      262_144,
      "HOST_EXECUTOR_MAX_OUTPUT_BYTES",
      1_024,
      2_147_483_647
    ),
    dryRun: parseBoolean(
      env.HOST_EXECUTOR_DRY_RUN,
      true,
      "HOST_EXECUTOR_DRY_RUN"
    ),
    egressAllowlist: (env.HOST_EXECUTOR_EGRESS_ALLOWLIST ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    browserbotBaseUrl: nonEmpty(env.BROWSERBOT_BASE_URL)
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

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string
): boolean {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be true, false, 1, or 0`);
}
