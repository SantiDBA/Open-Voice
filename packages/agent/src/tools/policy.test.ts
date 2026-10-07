import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolPolicyError, planToolCall } from "./policy.js";
import { TOOL_DEFINITIONS, findTool, toolPayload } from "./registry.js";

test("every registered tool maps to a sandbox action and is run without a gate", () => {
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(tool.action.length > 0, `${tool.name} must map to an action`);
    assert.equal(tool.enforcement, "sandbox", `${tool.name} runs inside the sandbox`);
    assert.equal(findTool(tool.name)?.name, tool.name);
  }
});

test("the tool payload is in the shape the model expects", () => {
  const payload = toolPayload(TOOL_DEFINITIONS);
  assert.equal(payload.length, TOOL_DEFINITIONS.length);
  for (const entry of payload) {
    assert.equal(entry.type, "function");
    assert.equal(typeof entry.function.name, "string");
    assert.equal(typeof entry.function.description, "string");
    assert.equal(entry.function.parameters["type"], "object");
  }
});

test("plans host_exec as a gated action that runs on the machine", () => {
  const planned = planToolCall({
    name: "host_exec",
    arguments: '{"command":"git status","cwd":""}'
  });

  assert.equal(planned.action, "exec");
  assert.equal(planned.enforcement, "gate", "it must never run without approval");
  assert.equal(planned.runsOn, "host");
  assert.deepEqual(planned.request, { kind: "exec", command: "git status" });
});

test("refuses a host_exec with no command", () => {
  assert.throws(
    () => planToolCall({ name: "host_exec", arguments: "{}" }),
    (error: unknown) => error instanceof ToolPolicyError
  );
});

test("plans host_file_read as a gated action that runs on the machine", () => {
  const planned = planToolCall({
    name: "host_file_read",
    arguments: '{"path":"config.yml"}'
  });

  assert.equal(planned.action, "read_file");
  assert.equal(planned.enforcement, "gate");
  assert.equal(planned.runsOn, "host");
  assert.deepEqual(planned.request, { kind: "read_file", path: "config.yml" });
});

test("refuses host_file_read with no path", () => {
  assert.throws(
    () => planToolCall({ name: "host_file_read", arguments: "{}" }),
    (error: unknown) => error instanceof ToolPolicyError
  );
});

test("plans host_file_write as a gated action that runs on the machine", () => {
  const planned = planToolCall({
    name: "host_file_write",
    arguments: '{"path":".env","content":"KEY=1"}'
  });

  assert.equal(planned.action, "write_file");
  assert.equal(planned.enforcement, "gate");
  assert.equal(planned.runsOn, "host");
  assert.deepEqual(planned.request, { kind: "write_file", path: ".env", content: "KEY=1" });
});

test("refuses host_file_write with no path or content", () => {
  assert.throws(
    () => planToolCall({ name: "host_file_write", arguments: '{"path":"x"}' }),
    (error: unknown) => error instanceof ToolPolicyError
  );
});

test("plans host_browse as a gated action that runs on the machine", () => {
  const planned = planToolCall({
    name: "host_browse",
    arguments: '{"url":"https://example.com","task":"find the price"}'
  });

  assert.equal(planned.action, "browse");
  assert.equal(planned.enforcement, "gate");
  assert.equal(planned.runsOn, "host");
  assert.deepEqual(planned.request, {
    kind: "browse",
    url: "https://example.com",
    task: "find the price"
  });
});

test("refuses host_browse with no url", () => {
  assert.throws(
    () => planToolCall({ name: "host_browse", arguments: "{}" }),
    (error: unknown) => error instanceof ToolPolicyError
  );
});

test("plans host_search as a gated action that runs on the machine", () => {
  const planned = planToolCall({
    name: "host_search",
    arguments: '{"query":"open voice agent framework","task":"research"}'
  });

  assert.equal(planned.action, "search");
  assert.equal(planned.enforcement, "gate");
  assert.equal(planned.runsOn, "host");
  assert.deepEqual(planned.request, {
    kind: "search",
    query: "open voice agent framework",
    task: "research"
  });
});

test("refuses host_search with no query", () => {
  assert.throws(
    () => planToolCall({ name: "host_search", arguments: "{}" }),
    (error: unknown) => error instanceof ToolPolicyError
  );
});

test("plans a run_command call into an exec action", () => {
  const planned = planToolCall({
    name: "run_command",
    arguments: '{"command":"echo hola","cwd":"sub"}'
  });

  assert.equal(planned.action, "exec");
  assert.equal(planned.enforcement, "sandbox");
  assert.deepEqual(planned.request, {
    kind: "exec",
    command: "echo hola",
    cwd: "sub"
  });
});

test("plans file tools, keeping only the arguments the action expects", () => {
  assert.deepEqual(
    planToolCall({ name: "read_file", arguments: '{"path":"a.txt","extra":"ignored"}' })
      .request,
    { kind: "read_file", path: "a.txt" }
  );

  assert.deepEqual(
    planToolCall({ name: "list_dir", arguments: "{}" }).request,
    { kind: "list_dir" }
  );

  assert.deepEqual(
    planToolCall({
      name: "edit_file",
      arguments: '{"path":"a.txt","find":"x","replace":"y","all":true}'
    }).request,
    { kind: "edit_file", path: "a.txt", find: "x", replace: "y", all: true }
  );
});

test("refuses a tool that does not exist", () => {
  assert.throws(
    () => planToolCall({ name: "rm_rf", arguments: "{}" }),
    (error: unknown) =>
      error instanceof ToolPolicyError && error.code === "unknown_tool"
  );
});

test("refuses arguments that are not a JSON object", () => {
  for (const args of ["not json", "[1,2]", '"a string"']) {
    assert.throws(
      () => planToolCall({ name: "read_file", arguments: args }),
      (error: unknown) =>
        error instanceof ToolPolicyError && error.code === "invalid_arguments",
      `expected a refusal for ${args}`
    );
  }
});

test("refuses a call missing a required argument", () => {
  assert.throws(
    () => planToolCall({ name: "write_file", arguments: '{"path":"a.txt"}' }),
    (error: unknown) =>
      error instanceof ToolPolicyError && error.code === "invalid_arguments"
  );

  assert.throws(
    () => planToolCall({ name: "run_command", arguments: '{"command":""}' }),
    (error: unknown) =>
      error instanceof ToolPolicyError && error.code === "invalid_arguments"
  );

  assert.throws(
    () => planToolCall({ name: "edit_file", arguments: '{"path":"a","find":""}' }),
    (error: unknown) => error instanceof ToolPolicyError
  );
});

test("accepts an empty replacement, which is how a deletion is expressed", () => {
  const planned = planToolCall({
    name: "edit_file",
    arguments: '{"path":"a.txt","find":"borrame ","replace":""}'
  });
  assert.equal(planned.request["replace"], "");
});

test("treats an empty optional string as not given, not as an error", () => {
  // Observed in the first real turn: a model sends `"cwd": ""` for "the default".
  // Refusing it costs a whole round-trip; dropping it costs nothing.
  assert.deepEqual(
    planToolCall({ name: "run_command", arguments: '{"command":"node x.js","cwd":""}' })
      .request,
    { kind: "exec", command: "node x.js" }
  );

  assert.deepEqual(
    planToolCall({ name: "list_dir", arguments: '{"path":""}' }).request,
    { kind: "list_dir" }
  );
});

test("still refuses an optional string of the wrong type", () => {
  assert.throws(
    () => planToolCall({ name: "run_command", arguments: '{"command":"x","cwd":7}' }),
    (error: unknown) => error instanceof ToolPolicyError
  );
});

test("refuses a timeout that is not a usable number", () => {
  assert.throws(
    () =>
      planToolCall({ name: "run_command", arguments: '{"command":"x","timeoutMs":10}' }),
    (error: unknown) => error instanceof ToolPolicyError
  );
});
