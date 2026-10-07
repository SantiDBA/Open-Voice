import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  WorkspaceEscapeError,
  resolveInsideWorkspace,
  workspaceRelative
} from "./workspace.js";

/**
 * The confinement tests are the reason this service exists. Each one is an
 * escape that must fail loudly rather than be silently clamped: a rejected
 * write is a bug report, a clamped write is a successful write somewhere the
 * caller did not name.
 */
describe("resolveInsideWorkspace", () => {
  let base: string;
  let root: string;
  let realRoot: string;
  let outside: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "open-voice-sandbox-"));
    root = path.join(base, "workspace");
    outside = path.join(base, "outside");
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "secret.txt"), "not for the agent");
    realRoot = fs.realpathSync(root);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("resolves a relative path inside the workspace", () => {
    expect(resolveInsideWorkspace(root, "notes.txt")).toBe(
      path.join(realRoot, "notes.txt")
    );
  });

  it("resolves a nested path that does not exist yet", () => {
    expect(resolveInsideWorkspace(root, "src/deep/new.ts")).toBe(
      path.join(realRoot, "src", "deep", "new.ts")
    );
  });

  it("accepts an absolute path that is inside the workspace", () => {
    expect(resolveInsideWorkspace(root, path.join(root, "a.txt"))).toBe(
      path.join(realRoot, "a.txt")
    );
  });

  it("treats the workspace root itself as inside", () => {
    expect(resolveInsideWorkspace(root, ".")).toBe(realRoot);
  });

  it("rejects a relative escape", () => {
    expect(() => resolveInsideWorkspace(root, "../outside/secret.txt")).toThrow(
      WorkspaceEscapeError
    );
  });

  it("rejects a deep traversal that climbs out and back in", () => {
    expect(() =>
      resolveInsideWorkspace(root, "a/b/../../../outside/secret.txt")
    ).toThrow(WorkspaceEscapeError);
  });

  it("rejects an absolute path outside the workspace", () => {
    expect(() =>
      resolveInsideWorkspace(root, path.join(outside, "secret.txt"))
    ).toThrow(WorkspaceEscapeError);
  });

  it("rejects a path through a symlinked directory that points outside", () => {
    fs.symlinkSync(outside, path.join(root, "link"));
    expect(() => resolveInsideWorkspace(root, "link/secret.txt")).toThrow(
      WorkspaceEscapeError
    );
  });

  it("rejects a new file created through a symlinked directory that points outside", () => {
    fs.symlinkSync(outside, path.join(root, "link"));
    expect(() => resolveInsideWorkspace(root, "link/brand-new.txt")).toThrow(
      WorkspaceEscapeError
    );
  });

  it("rejects a symlinked file that points outside", () => {
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "leak.txt"));
    expect(() => resolveInsideWorkspace(root, "leak.txt")).toThrow(
      WorkspaceEscapeError
    );
  });

  it("allows a symlink that stays inside the workspace", () => {
    fs.mkdirSync(path.join(root, "real"));
    fs.writeFileSync(path.join(root, "real", "inner.txt"), "fine");
    fs.symlinkSync(path.join(root, "real"), path.join(root, "alias"));
    expect(resolveInsideWorkspace(root, "alias/inner.txt")).toBe(
      path.join(realRoot, "real", "inner.txt")
    );
  });

  it("rejects a path containing a NUL byte", () => {
    expect(() => resolveInsideWorkspace(root, "a\0b")).toThrow(
      WorkspaceEscapeError
    );
  });

  it("rejects an empty or non-string path", () => {
    expect(() => resolveInsideWorkspace(root, "")).toThrow(WorkspaceEscapeError);
    expect(() => resolveInsideWorkspace(root, undefined)).toThrow(
      WorkspaceEscapeError
    );
    expect(() => resolveInsideWorkspace(root, 42)).toThrow(WorkspaceEscapeError);
  });

  it("reports a workspace-relative path for the caller", () => {
    expect(workspaceRelative(root, path.join(root, "a", "b.txt"))).toBe(
      path.join("a", "b.txt")
    );
    expect(workspaceRelative(root, root)).toBe(".");
  });
});
