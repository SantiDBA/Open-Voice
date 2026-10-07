import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { CommandRefused, assertRunnable, isCommandAllowed } from "./allowlist.js";

describe(isCommandAllowed, () => {
  test("matches the whole command, including wildcards", () => {
    assert.equal(isCommandAllowed("echo hola", ["echo *"]), true);
    assert.equal(isCommandAllowed("echo", ["echo *"]), false, "the space is part of the pattern");
    assert.equal(isCommandAllowed("echo hola", ["echo"]), false);
    assert.equal(isCommandAllowed("git status", ["git status", "git log *"]), true);
    assert.equal(isCommandAllowed("git push", ["git status", "git log *"]), false);
  });

  test("does not let a wildcard match a different command", () => {
    assert.equal(isCommandAllowed("echohola", ["echo *"]), false);
  });
});

describe(assertRunnable, () => {
  test("refuses everything when nothing is allowed", () => {
    assert.throws(
      () => assertRunnable("echo hola", []),
      (error: unknown) => error instanceof CommandRefused && error.code === "not_allowed"
    );
  });

  test("refuses a command that is not on the list", () => {
    assert.throws(
      () => assertRunnable("rm -rf /", ["echo *"]),
      (error: unknown) => error instanceof CommandRefused && error.code === "not_allowed"
    );
  });

  test("allows a single simple command that matches", () => {
    assert.doesNotThrow(() => assertRunnable("echo hola", ["echo *"]));
  });

  /**
   * The finding this whole module exists for: a prefix pattern would otherwise
   * match anything appended to it, so `echo *` would allow the second half of
   * `echo hi && rm -rf ~`.
   */
  test("refuses any command that chains, pipes or substitutes, whatever the allowlist says", () => {
    for (const command of [
      "echo hi && rm -rf ~",
      "echo hi; rm -rf ~",
      "echo hi || rm -rf ~",
      "echo hi | sh",
      "echo `whoami`",
      "echo $(whoami)",
      "echo hi > /etc/passwd",
      "cat < /etc/shadow",
      "echo hi\nrm -rf ~"
    ]) {
      assert.throws(
        () => assertRunnable(command, ["*", "echo *"]),
        (error: unknown) =>
          error instanceof CommandRefused && error.code === "compound_command",
        `expected a refusal for: ${command}`
      );
    }
  });

  test("refuses a compound command before it considers the allowlist at all", () => {
    // Even an explicit allow-everything pattern cannot make chaining safe.
    assert.throws(
      () => assertRunnable("ls;a", ["*"]),
      (error: unknown) => error instanceof CommandRefused && error.code === "compound_command"
    );
  });
});
