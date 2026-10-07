/**
 * What the host executor will run.
 *
 * Two checks, and the order matters:
 *
 * 1. **The command must be a single simple command.** A shell metacharacter —
 *    a pipe, a chain, a substitution, a redirect — is refused outright, before
 *    the allowlist is even consulted. Without this, `echo *` would also allow
 *    `echo hi && rm -rf ~`, because a pattern that matches a prefix matches
 *    whatever follows it. An allowlist over a compound command is not an
 *    allowlist.
 * 2. **The command must match a pattern.** The list starts empty, so the
 *    default is that the host runs nothing at all.
 */

/** Characters that turn one command into a shell program. */
const SHELL_METACHARACTERS = [";", "&&", "||", "|", "`", "$(", ">", "<", "\n", "\r"];

export class CommandRefused extends Error {
  constructor(
    readonly code: "compound_command" | "not_allowed",
    message: string
  ) {
    super(message);
    this.name = "CommandRefused";
  }
}

export function assertRunnable(
  command: string,
  patterns: readonly string[]
): void {
  const found = SHELL_METACHARACTERS.find((token) => command.includes(token));
  if (found !== undefined) {
    throw new CommandRefused(
      "compound_command",
      `The host executor runs one simple command at a time; "${found}" is not allowed. Split it into separate commands.`
    );
  }

  if (patterns.length === 0) {
    throw new CommandRefused(
      "not_allowed",
      "No commands are allowed on this machine. Add one to HOST_EXECUTOR_ALLOWED_COMMANDS."
    );
  }

  if (!isCommandAllowed(command, patterns)) {
    throw new CommandRefused(
      "not_allowed",
      `"${command}" does not match any allowed command pattern.`
    );
  }
}

/**
 * A pattern matches the whole command. `*` matches any run of characters;
 * everything else is literal. `echo *` matches `echo hi` and does not match
 * `echo` alone, because the space is part of the pattern.
 */
export function isCommandAllowed(
  command: string,
  patterns: readonly string[]
): boolean {
  const trimmed = command.trim();
  return patterns.some((pattern) => {
    const normalized = pattern.trim();
    if (normalized.length === 0) {
      return false;
    }
    if (!normalized.includes("*")) {
      return trimmed === normalized;
    }
    const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const source = `^${escaped.split("*").join(".*")}$`;
    return new RegExp(source).test(trimmed);
  });
}
