/**
 * Configuration for the browserbot service.
 *
 * Loaded from environment variables with fail-fast validation: a malformed
 * value is a startup error, not a silent fallback.
 */
export interface BrowserbotConfig {
  /** The address the browserbot listens on. */
  host: string;
  /** The port the browserbot listens on. */
  port: number;
  /**
   * The browser viewport width. Screenshots are capped to this to bound the
   * token cost of sending them back to the model.
   */
  width: number;
  /**
   * The browser viewport height.
   */
  height: number;
  /**
   * When true, the browserbot refuses all outbound navigation (deny-by-default
   * for network egress). Local actions (screenshot, read text) still work.
   */
  dryRun: boolean;
  /**
   * The egress allowlist: domains the browser is allowed to navigate to. An
   * empty list means no external navigation is permitted.
   */
  egressAllowlist: readonly string[];
  /**
   * Maximum time (ms) a single browser action may take before the browserbot
   * gives up.
   */
  timeoutMs: number;
}

/** Parse a string as a boolean, accepting only the canonical forms. */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "true" || trimmed === "1" || trimmed === "yes") return true;
  if (trimmed === "false" || trimmed === "0" || trimmed === "no") return false;
  throw new Error(
    `invalid boolean value for env var: "${value}" — expected true|false|0|1|yes|no`
  );
}

/** Parse a string as a port number. */
function parsePort(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `invalid port value: "${value}" — expected an integer 1–65535`
    );
  }
  return parsed;
}

/** Parse a string as a positive integer. */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `invalid numeric value: "${value}" — expected a positive integer`
    );
  }
  return parsed;
}

/** Parse a comma-separated allowlist, e.g. "*.duckduckgo.com,example.com". */
function parseAllowlist(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export { parseBoolean, parsePort, parseNumber };

/** Load the browserbot configuration from env, with validation. */
export function loadBrowserbotConfig(): BrowserbotConfig {
  const rawAllowlist = process.env.HOST_EXECUTOR_EGRESS_ALLOWLIST;
  const egressAllowlist = rawAllowlist
    ? parseAllowlist(rawAllowlist)
    : [];

  return {
    host: process.env.BROWSERBOT_HOST ?? "127.0.0.1",
    port: parsePort(process.env.BROWSERBOT_PORT, 8792),
    width: parseNumber(process.env.BROWSERBOT_WIDTH, 1280),
    height: parseNumber(process.env.BROWSERBOT_HEIGHT, 800),
    dryRun: parseBoolean(process.env.HOST_EXECUTOR_DRY_RUN, true),
    egressAllowlist,
    timeoutMs: parseNumber(process.env.BROWSERBOT_TIMEOUT_MS, 30_000)
  };
}

