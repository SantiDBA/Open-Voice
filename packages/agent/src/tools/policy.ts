import {
  findTool,
  type Enforcement,
  type RunsOn,
  type ToolAction
} from "./registry.js";

/**
 * Turns a tool call the model produced into a sandbox request, or refuses it.
 *
 * Two things are checked here and nowhere else: that the tool exists, and that
 * its arguments are the shape that tool declares. The sandbox validates again
 * on its side — this is not the security boundary — but a refusal here is a
 * clear, cheap error the model can correct, instead of a round-trip that ends
 * in a 400.
 */
export class ToolPolicyError extends Error {
  constructor(
    readonly code: "unknown_tool" | "invalid_arguments",
    message: string
  ) {
    super(message);
    this.name = "ToolPolicyError";
  }
}

export interface PlannedCall {
  tool: string;
  action: ToolAction;
  enforcement: Enforcement;
  runsOn: RunsOn;
  /** The body to send, without the action id. */
  request: Record<string, unknown>;
}

export function planToolCall(call: {
  name: string;
  arguments: string;
}): PlannedCall {
  const definition = findTool(call.name);
  if (!definition) {
    throw new ToolPolicyError(
      "unknown_tool",
      `There is no tool named "${call.name}".`
    );
  }

  const args = parseArguments(call.arguments);
  const request = validateArguments(definition.name, args);

  return {
    tool: definition.name,
    action: definition.action,
    enforcement: definition.enforcement,
    runsOn: definition.runsOn,
    request: { kind: definition.action, ...request }
  };
}

function parseArguments(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (text.length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ToolPolicyError(
      "invalid_arguments",
      `The tool arguments were not valid JSON: ${raw.slice(0, 120)}`
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ToolPolicyError(
      "invalid_arguments",
      "The tool arguments must be a JSON object."
    );
  }
  return parsed as Record<string, unknown>;
}

function validateArguments(
  tool: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  switch (tool) {
    case "read_file":
      return { path: requiredString(args, "path") };

    case "write_file":
      return {
        path: requiredString(args, "path"),
        content: requiredString(args, "content", { allowEmpty: true })
      };

    case "edit_file":
      return {
        path: requiredString(args, "path"),
        find: requiredString(args, "find"),
        replace: requiredString(args, "replace", { allowEmpty: true }),
        ...(args["all"] === undefined ? {} : { all: requiredBoolean(args, "all") })
      };

    case "list_dir": {
      const path = optionalString(args, "path");
      return path === undefined ? {} : { path };
    }

    case "run_command": {
      const cwd = optionalString(args, "cwd");
      return {
        command: requiredString(args, "command"),
        ...(cwd === undefined ? {} : { cwd }),
        ...(args["timeoutMs"] === undefined
          ? {}
          : { timeoutMs: requiredPositiveInteger(args, "timeoutMs") })
      };
    }

    case "host_exec": {
      const cwd = optionalString(args, "cwd");
      return {
        command: requiredString(args, "command"),
        ...(cwd === undefined ? {} : { cwd })
      };
    }

    case "host_file_read": {
      return { path: requiredString(args, "path") };
    }

    case "host_file_write": {
      return {
        path: requiredString(args, "path"),
        content: requiredString(args, "content", { allowEmpty: true })
      };
    }

    case "host_browse": {
      return {
        url: requiredString(args, "url"),
        ...(args["task"] !== undefined ? { task: requiredString(args, "task", { allowEmpty: true }) } : {})
      };
    }

    case "host_search": {
      return {
        query: requiredString(args, "query"),
        ...(args["task"] !== undefined ? { task: requiredString(args, "task", { allowEmpty: true }) } : {})
      };
    }

    case "host_interact": {
      const action = requiredString(args, "action");
      const validActions = ["navigate", "click", "type", "scroll", "screenshot", "read"];
      if (!validActions.includes(action)) {
        throw new ToolPolicyError(
          "invalid_arguments",
          `action must be one of: ${validActions.join(", ")}.`
        );
      }
      const request: Record<string, unknown> = { action };
      // URL is required for navigate and gets SSRF-checked by the host executor.
      if (args["url"] !== undefined) {
        request.url = requiredString(args, "url");
      }
      if (args["selector"] !== undefined) {
        request.selector = requiredString(args, "selector");
      }
      if (args["x"] !== undefined) {
        request.x = args["x"];
      }
      if (args["y"] !== undefined) {
        request.y = args["y"];
      }
      if (args["text"] !== undefined) {
        request.text = requiredString(args, "text", { allowEmpty: true });
      }
      if (args["scrollX"] !== undefined) {
        request.scrollX = args["scrollX"];
      }
      if (args["scrollY"] !== undefined) {
        request.scrollY = args["scrollY"];
      }
      if (args["task"] !== undefined) {
        request.task = requiredString(args, "task", { allowEmpty: true });
      }
      return request;
    }

    default:
      // Unreachable: the tool name was checked against the registry above.
      throw new ToolPolicyError("unknown_tool", `There is no tool named "${tool}".`);
  }
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean } = {}
): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new ToolPolicyError(
      "invalid_arguments",
      `"${key}" must be a string.`
    );
  }
  if (!options.allowEmpty && value.length === 0) {
    throw new ToolPolicyError(
      "invalid_arguments",
      `"${key}" must not be empty.`
    );
  }
  return value;
}

function requiredBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== "boolean") {
    throw new ToolPolicyError("invalid_arguments", `"${key}" must be a boolean.`);
  }
  return value;
}

/**
 * An optional string, where an empty one means "not given".
 *
 * Models routinely send `"cwd": ""` for "use the default". Refusing that would
 * be technically defensible and a waste of a whole round-trip — observed doing
 * exactly that in the first real turn — so an empty value is treated as absent
 * and the default applies. A value of the wrong type is still an error.
 */
function optionalString(
  args: Record<string, unknown>,
  key: string
): string | undefined {
  const value = args[key];
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ToolPolicyError("invalid_arguments", `"${key}" must be a string.`);
  }
  return value;
}

function requiredPositiveInteger(
  args: Record<string, unknown>,
  key: string
): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100) {
    throw new ToolPolicyError(
      "invalid_arguments",
      `"${key}" must be an integer of at least 100.`
    );
  }
  return value;
}
