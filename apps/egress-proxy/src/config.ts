/**
 * Configuration for the egress proxy.
 *
 * The allowlist has no default: an unset `EGRESS_ALLOWED_DOMAINS` means the
 * sandbox can reach nothing, which is the documented starting position.
 */
export interface EgressProxyConfig {
  host: string;
  port: number;
  /** Domain patterns. Empty means no egress at all. */
  allowedDomains: string[];
}

export function loadEgressProxyConfig(
  env: NodeJS.ProcessEnv = process.env
): EgressProxyConfig {
  return {
    // Binds every interface inside its container; the sandbox reaches it by
    // service name and nothing outside the internal network can.
    host: nonEmpty(env.EGRESS_HOST) ?? "0.0.0.0",
    port: parseInteger(env.EGRESS_PORT, 8080, "EGRESS_PORT", 1, 65_535),
    allowedDomains: (env.EGRESS_ALLOWED_DOMAINS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
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
