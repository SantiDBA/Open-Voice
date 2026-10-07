import {
  DEFAULT_ENV_KEYS,
  minimalEnvironment as minimalEnvironmentFrom,
  runCommand as runCommandFrom,
  type ExecOptions,
  type ExecOutcome
} from "@open-voice/exec";

export type { ExecOptions, ExecOutcome };
/**
 * The sandbox's view of command execution.
 *
 * The mechanics live in `@open-voice/exec`; what the sandbox adds is which
 * environment a command may inherit. The proxy variables are included on
 * purpose: the sandbox has no route out, so a tool that ignores them simply
 * cannot reach the network. They are the only way out, not a convenience.
 */
const SANDBOX_ENV_KEYS = [
  ...DEFAULT_ENV_KEYS,
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy"
] as const;

export function minimalEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return minimalEnvironmentFrom(source, SANDBOX_ENV_KEYS);
}

export function runCommand(options: ExecOptions): Promise<ExecOutcome> {
  return runCommandFrom({ ...options, envKeys: SANDBOX_ENV_KEYS });
}
