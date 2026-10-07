import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActionError, ActionRegistry, runAction, type ActionContext } from "./actions.js";

describe("runAction", () => {
  let workspace: string;
  let controller: AbortController;
  let context: ActionContext;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "open-voice-actions-"));
    controller = new AbortController();
    context = {
      workspace,
      maxOutputBytes: 64,
      actionTimeoutMs: 5_000,
      signal: controller.signal
    };
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  describe("files", () => {
    it("writes and reads a file back", async () => {
      const written = await runAction(
        { kind: "write_file", path: "notes/hello.txt", content: "hola" },
        context
      );
      expect(written).toMatchObject({
        status: "ok",
        kind: "write_file",
        path: path.join("notes", "hello.txt"),
        bytes: 4
      });

      const read = await runAction(
        { kind: "read_file", path: "notes/hello.txt" },
        context
      );
      expect(read).toMatchObject({
        status: "ok",
        kind: "read_file",
        content: "hola",
        truncated: false
      });
    });

    it("truncates a read at the output ceiling", async () => {
      await runAction(
        { kind: "write_file", path: "big.txt", content: "x".repeat(500) },
        context
      );
      const read = await runAction({ kind: "read_file", path: "big.txt" }, context);
      expect(read.status).toBe("ok");
      expect(read.content).toHaveLength(64);
      expect(read.truncated).toBe(true);
    });

    it("lists a directory with types and sizes, sorted", async () => {
      await runAction({ kind: "write_file", path: "b.txt", content: "bb" }, context);
      await runAction({ kind: "write_file", path: "a.txt", content: "a" }, context);
      await runAction({ kind: "write_file", path: "dir/inner.txt", content: "i" }, context);

      const listed = await runAction({ kind: "list_dir", path: "." }, context);
      expect(listed.status).toBe("ok");
      expect(listed.entries?.map((entry) => entry.name)).toEqual([
        "a.txt",
        "b.txt",
        "dir"
      ]);
      expect(listed.entries?.[0]).toMatchObject({ name: "a.txt", type: "file", size: 1 });
      expect(listed.entries?.[2]).toMatchObject({ name: "dir", type: "directory" });
    });

    it("edits the first occurrence, or all of them on request", async () => {
      await runAction(
        { kind: "write_file", path: "code.ts", content: "let a = 1;\nlet a = 2;\n" },
        context
      );

      const first = await runAction(
        { kind: "edit_file", path: "code.ts", find: "let a", replace: "const a" },
        context
      );
      expect(first.replacements).toBe(1);

      const all = await runAction(
        {
          kind: "edit_file",
          path: "code.ts",
          find: "let a",
          replace: "const a",
          all: true
        },
        context
      );
      expect(all.replacements).toBe(1);

      const content = fs.readFileSync(path.join(workspace, "code.ts"), "utf8");
      expect(content).toBe("const a = 1;\nconst a = 2;\n");
    });

    it("reports zero replacements instead of failing when find matches nothing", async () => {
      await runAction({ kind: "write_file", path: "x.txt", content: "hola" }, context);
      const outcome = await runAction(
        { kind: "edit_file", path: "x.txt", find: "nope", replace: "yes" },
        context
      );
      expect(outcome).toMatchObject({ status: "ok", replacements: 0 });
    });

    it("replaces every occurrence when all is true", async () => {
      await runAction({ kind: "write_file", path: "multi.txt", content: "x x x" }, context);
      const outcome = await runAction(
        { kind: "edit_file", path: "multi.txt", find: "x", replace: "y", all: true },
        context
      );
      expect(outcome.replacements).toBe(3);
      expect(fs.readFileSync(path.join(workspace, "multi.txt"), "utf8")).toBe("y y y");
    });

    it("refuses to read outside the workspace", async () => {
      await expect(
        runAction({ kind: "read_file", path: "../outside.txt" }, context)
      ).rejects.toBeInstanceOf(ActionError);
    });
  });

  describe("exec", () => {
    it("runs a command and returns its output", async () => {
      const outcome = await runAction(
        { kind: "exec", command: "echo hola" },
        context
      );
      expect(outcome).toMatchObject({ status: "ok", kind: "exec", exitCode: 0 });
      expect(outcome.stdout).toBe("hola\n");
    });

    it("reports a non-zero exit as an error result, not a thrown error", async () => {
      const outcome = await runAction(
        { kind: "exec", command: "exit 3" },
        context
      );
      expect(outcome.status).toBe("error");
      expect(outcome.exitCode).toBe(3);
    });

    it("truncates output past the ceiling", async () => {
      const outcome = await runAction(
        { kind: "exec", command: "head -c 400 /dev/zero | tr '\\0' 'x'" },
        context
      );
      expect(outcome.status).toBe("ok");
      expect(outcome.truncated).toBe(true);
      expect(outcome.stdout).toHaveLength(64);
    });

    it("kills a command that outlives its timeout", async () => {
      const outcome = await runAction(
        { kind: "exec", command: "sleep 30", timeoutMs: 300 },
        context
      );
      expect(outcome.status).toBe("timeout");
      expect(outcome.durationMs).toBeLessThan(5_000);
    });

    it("cancels a command when the action is aborted", async () => {
      const pending = runAction({ kind: "exec", command: "sleep 30" }, context);
      setTimeout(() => controller.abort(), 150);
      const outcome = await pending;
      expect(outcome.status).toBe("cancelled");
      expect(outcome.durationMs).toBeLessThan(5_000);
    });

    it("does not inherit the server's environment", async () => {
      process.env["OPEN_VOICE_SANDBOX_TEST_SECRET"] = "leaked";
      try {
        const outcome = await runAction(
          { kind: "exec", command: "printenv OPEN_VOICE_SANDBOX_TEST_SECRET || echo absent" },
          context
        );
        expect(outcome.stdout?.trim()).toBe("absent");
      } finally {
        delete process.env["OPEN_VOICE_SANDBOX_TEST_SECRET"];
      }
    });

    it("passes the proxy variables through, since they are the only way out", async () => {
      process.env["HTTPS_PROXY"] = "http://egress-proxy:8080";
      process.env["NO_PROXY"] = "";
      try {
        const outcome = await runAction(
          { kind: "exec", command: "printenv HTTPS_PROXY" },
          context
        );
        expect(outcome.stdout?.trim()).toBe("http://egress-proxy:8080");
      } finally {
        delete process.env["HTTPS_PROXY"];
        delete process.env["NO_PROXY"];
      }
    });

    it("rejects a command with an escaping working directory", async () => {
      await expect(
        runAction({ kind: "exec", command: "pwd", cwd: "../../" }, context)
      ).rejects.toBeInstanceOf(ActionError);
    });
  });

  describe("requests", () => {
    it("rejects an unknown kind", async () => {
      await expect(runAction({ kind: "rm_rf" }, context)).rejects.toBeInstanceOf(
        ActionError
      );
    });

    it("rejects a body that is not an object", async () => {
      await expect(runAction("exec", context)).rejects.toBeInstanceOf(ActionError);
    });
  });
});

describe("ActionRegistry", () => {
  it("cancels only the action that is running", () => {
    const registry = new ActionRegistry();
    const controller = registry.begin("a");
    expect(registry.size).toBe(1);
    expect(registry.cancel("missing")).toBe(false);
    expect(registry.cancel("a")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    registry.end("a");
    expect(registry.size).toBe(0);
  });
});
