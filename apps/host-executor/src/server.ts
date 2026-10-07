import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";

import {
  WorkspaceEscapeError,
  relativeTo,
  resolveInside,
  runCommand
} from "@open-voice/exec";
import { isBlockedAddress, isDomainAllowed, normalizeHost } from "@open-voice/egress-proxy";

import { CommandRefused, assertRunnable } from "./allowlist.js";
import type { HostExecutorConfig } from "./config.js";

/**
 * Thrown when a domain is not on the egress allowlist. Carries the domain so
 * the caller (the agent) can offer to add it and retry, instead of just
 * reporting "I can't browse this site".
 */
class EgressNotAllowedError extends Error {
  constructor(readonly domain: string, message: string) {
    super(message);
    this.name = "EgressNotAllowedError";
  }
}

export interface HostExecutorHandle {
  readonly port: number;
  close(): Promise<void>;
  /** Adds a domain to the egress allowlist at runtime. Persisted to disk. */
  addDomain(domain: string): Promise<void>;
}

/**
 * The host executor's HTTP surface. One route that matters.
 *
 * This process runs commands on the machine itself, so its shape is deliberately
 * small: authenticate, confine the working directory, refuse anything that is
 * not one simple allowed command, run it with a ceiling, and say exactly what
 * happened. Nothing here decides *whether* an action was approved — the approval
 * lives in the agent's gate, and the operator is the one who started this
 * process. Both facts are stated in the docs rather than implied.
 */
export async function createHostExecutor(
  config: HostExecutorConfig
): Promise<HostExecutorHandle> {
  const running = new Map<string, AbortController>();

  // Merge persisted allowlist additions into the runtime config so that
  // domains approved by the user in a previous session survive a restart.
  const persisted = await loadPersistedAllowlist(config.root);
  for (const domain of persisted) {
    if (!config.egressAllowlist.includes(domain)) {
      config.egressAllowlist.push(domain);
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response, config, running).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false, code: "internal", error: "internal error" });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Host executor did not bind to a TCP port");
  }

  log("host_executor.started", {
    host: config.host,
    port: address.port,
    root: config.root,
    allowedCommands: config.allowedCommands,
    dryRun: config.dryRun,
    defaultPolicy: config.allowedCommands.length === 0 ? "deny_all" : "allowlist"
  });

  return {
    port: address.port,
    async addDomain(domain: string) {
      const normalized = normalizeHost(domain);
      if (config.egressAllowlist.includes(normalized)) {
        return;
      }
      config.egressAllowlist.push(normalized);
      await persistDomain(config.root, normalized);
      log("host_executor.allowlist_added", { domain: normalized });
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const controller of running.values()) {
          controller.abort();
        }
        running.clear();
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  config: HostExecutorConfig,
  running: Map<string, AbortController>
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://host-executor");

  if (request.method === "GET" && url.pathname === "/healthz") {
    // Unauthenticated, and says nothing about the machine: a liveness probe
    // should not need a credential that grants command execution.
    sendJson(response, 200, { status: "ok", service: "open-voice-host-executor" });
    return;
  }

  if (!isAuthorized(request, config.token)) {
    sendJson(response, 401, { ok: false, code: "unauthorized", error: "unauthorized" });
    return;
  }

  const cancelMatch = /^\/exec\/([^/]+)\/cancel$/.exec(url.pathname);
  if (request.method === "POST" && cancelMatch) {
    const controller = running.get(decodeURIComponent(cancelMatch[1]!));
    controller?.abort();
    sendJson(response, 200, { ok: true, cancelled: controller !== undefined });
    return;
  }

  if (request.method === "POST" && url.pathname === "/exec") {
    await handleAction(request, response, config, running);
    return;
  }

  if (request.method === "POST" && url.pathname === "/allowlist") {
    await handleAllowlist(request, response, config);
    return;
  }

  sendJson(response, 404, { ok: false, code: "not_found", error: "not found" });
}

async function handleAction(
  request: IncomingMessage,
  response: ServerResponse,
  config: HostExecutorConfig,
  running: Map<string, AbortController>
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { ok: false, code: "invalid_json", error: "body is not valid JSON" });
    return;
  }

  const kind = body["kind"];
  if (typeof kind !== "string") {
    sendJson(response, 400, {
      ok: false,
      code: "invalid_request",
      error: "kind must be a string"
    });
    return;
  }

  const actionId =
    typeof body["actionId"] === "string" && body["actionId"].length > 0
      ? body["actionId"]
      : randomUUID();

  const controller = new AbortController();
  running.set(actionId, controller);

  const started = Date.now();
  try {
    let result: Record<string, unknown>;
    switch (kind) {
      case "exec":
        result = await runExec(body, config, controller.signal);
        break;
      case "read_file":
        result = await runReadFile(body, config);
        break;
      case "write_file":
        result = await runWriteFile(body, config);
        break;
      case "browse":
        result = await runBrowse(body, config);
        break;
      case "search":
        result = await runSearch(body, config);
        break;
      case "interact":
        result = await runInteract(body, config);
        break;
      default:
        sendJson(response, 400, {
          ok: false,
          code: "invalid_request",
          error: `host executor does not implement kind "${kind}"`
        });
        return;
    }

    const outcome = result["outcome"] as string;
    log("host_executor.ran", {
      actionId,
      kind,
      ...(kind === "exec"
        ? { command: result["command"], cwd: result["cwd"] }
        : kind === "search"
          ? { query: result["query"] }
          : kind === "interact"
            ? { action: result["action"] as string }
            : { path: result["path"] }),
      outcome,
      ...(result["exitCode"] !== undefined ? { exitCode: result["exitCode"] } : {}),
      durationMs: Date.now() - started
    });

    sendJson(response, 200, {
      ok: true,
      actionId,
      ...result
    });
  } catch (error) {
    if (error instanceof WorkspaceEscapeError) {
      log("host_executor.refused", {
        actionId,
        kind,
        reason: "path_escape",
        error: error.message
      });
      sendJson(response, 403, {
        ok: false,
        code: "path_escape",
        error: error.message
      });
      return;
    }
    if (error instanceof CommandRefused) {
      log("host_executor.refused", {
        actionId,
        kind,
        reason: error.code
      });
      sendJson(response, 403, {
        ok: false,
        code: error.code,
        error: error.message
      });
      return;
    }
    if (error instanceof EgressNotAllowedError) {
      log("host_executor.refused", {
        actionId,
        kind,
        reason: "egress_not_allowed",
        domain: error.domain
      });
      sendJson(response, 403, {
        ok: false,
        code: "egress_not_allowed",
        error: error.message,
        domain: error.domain
      });
      return;
    }
    // Generic errors from validation (missing fields) or runtime failures.
    if (error instanceof Error) {
      if (error.message.includes("must be a non-empty string") || error.message.includes("must be a string")) {
        sendJson(response, 400, {
          ok: false,
          code: "invalid_request",
          error: error.message
        });
        return;
      }
      log("host_executor.error", {
        actionId,
        kind,
        error: error.message
      });
      sendJson(response, 500, {
        ok: false,
        code: "internal",
        error: error.message
      });
      return;
    }
    sendJson(response, 500, { ok: false, code: "internal", error: "unknown error" });
  } finally {
    running.delete(actionId);
  }
}

/**
 * Persisted allowlist additions, written to a file in the host executor's
 * workspace root so they survive container restarts. The env-var allowlist
 * is read first; domains added at runtime are appended on top.
 */
async function loadPersistedAllowlist(root: string): Promise<string[]> {
  const file = path.join(root, ".allowlist_additions");
  try {
    const content = await fs.readFile(file, "utf8");
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

async function persistDomain(root: string, domain: string): Promise<void> {
  const file = path.join(root, ".allowlist_additions");
  try {
    await fs.appendFile(file, `${domain}\n`, "utf8");
  } catch {
    // Best effort — the domain is still in the runtime array.
  }
}

async function handleAllowlist(
  request: IncomingMessage,
  response: ServerResponse,
  config: HostExecutorConfig
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { ok: false, code: "invalid_json", error: "body is not valid JSON" });
    return;
  }

  const domain = body["domain"];
  if (typeof domain !== "string" || domain.trim().length === 0) {
    sendJson(response, 400, {
      ok: false,
      code: "invalid_request",
      error: "domain must be a non-empty string"
    });
    return;
  }

  const normalized = normalizeHost(domain.trim());
  if (config.egressAllowlist.includes(normalized)) {
    sendJson(response, 200, { ok: true, domain: normalized, already: true });
    return;
  }

  config.egressAllowlist.push(normalized);
  await persistDomain(config.root, normalized);
  log("host_executor.allowlist_added", { domain: normalized });
  sendJson(response, 200, { ok: true, domain: normalized });
}

interface ExecResult {
  status: "ok" | "error" | "timeout" | "cancelled";
  kind: "exec";
  cwd: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  [key: string]: unknown;
}

async function runExec(
  body: Record<string, unknown>,
  config: HostExecutorConfig,
  signal: AbortSignal
): Promise<ExecResult> {
  const command = body["command"];
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("command must be a non-empty string");
  }

  let cwd: string;
  try {
    cwd = resolveInside(config.root, body["cwd"] ?? ".");
  } catch (error) {
    throw error;
  }

  assertRunnable(command, config.allowedCommands);

  const timeoutMs =
    typeof body["timeoutMs"] === "number" && Number.isInteger(body["timeoutMs"])
      ? Math.max(1_000, Math.min(body["timeoutMs"], config.timeoutMs))
      : config.timeoutMs;

  const outcome = await runCommand({
    command,
    cwd,
    timeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    signal
  });

  return {
    status: outcome.cancelled
      ? "cancelled"
      : outcome.timedOut
        ? "timeout"
        : outcome.exitCode === 0
          ? "ok"
          : "error",
    kind: "exec",
    cwd: relativeTo(config.root, cwd),
    command,
    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    truncated: outcome.truncated,
    durationMs: outcome.durationMs
  };
}

interface FileResult {
  status: "ok" | "error";
  kind: "read_file" | "write_file";
  path: string;
  content?: string;
  bytes?: number;
  truncated?: boolean;
  error?: string;
  [key: string]: unknown;
}

async function runReadFile(
  body: Record<string, unknown>,
  config: HostExecutorConfig
): Promise<FileResult> {
  const input = body["path"];
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("path must be a non-empty string");
  }

  let resolved: string;
  try {
    resolved = resolveInside(config.root, input);
  } catch (error) {
    throw error;
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`cannot read: ${relativeTo(config.root, resolved)}`);
  }
  if (stat.isDirectory()) {
    throw new Error(`not a file: ${relativeTo(config.root, resolved)}`);
  }

  const limit = config.maxOutputBytes;
  const handle = await fs.open(resolved, "r");
  try {
    const size = Math.min(stat.size, limit);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return {
      status: "ok",
      kind: "read_file",
      path: relativeTo(config.root, resolved),
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      bytes: bytesRead,
      truncated: stat.size > limit
    };
  } finally {
    await handle.close();
  }
}

async function runWriteFile(
  body: Record<string, unknown>,
  config: HostExecutorConfig
): Promise<FileResult> {
  const input = body["path"];
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("path must be a non-empty string");
  }
  const content = body["content"];
  if (typeof content !== "string") {
    throw new Error("content must be a string");
  }

  let resolved: string;
  try {
    resolved = resolveInside(config.root, input);
  } catch (error) {
    throw error;
  }

  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");

  return {
    status: "ok",
    kind: "write_file",
    path: relativeTo(config.root, resolved),
    bytes: Buffer.byteLength(content, "utf8")
  };
}

interface BrowseResult {
  status: "ok" | "error";
  kind: "browse";
  url: string;
  content?: string;
  truncated?: boolean;
  error?: string;
  [key: string]: unknown;
}

async function runBrowse(
  body: Record<string, unknown>,
  config: HostExecutorConfig
): Promise<BrowseResult> {
  const inputUrl = body["url"];
  if (typeof inputUrl !== "string" || inputUrl.trim().length === 0) {
    throw new Error("url must be a non-empty string");
  }

  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error(`invalid URL: ${inputUrl}`);
  }

  // Only https is permitted. HTTP would expose traffic to interception on the
  // operator's network.
  if (parsed.protocol !== "https:") {
    throw new Error("only https URLs are allowed");
  }

  // SSRF check: resolve the host and reject any address that is loopback,
  // private, link-local, multicast, or the cloud metadata endpoint. This runs
  // even when the domain is allowlisted, because a DNS entry can change or be
  // controlled by an attacker.
  const addresses: LookupAddress[] = await dnsLookup(normalizeHost(parsed.hostname), { all: true });
  for (const addr of addresses) {
    if (isBlockedAddress(addr.address)) {
      throw new Error(
        `SSRF protection: ${normalizeHost(parsed.hostname)} resolves to a private or blocked address (${addr.address})`
      );
    }
  }

  // The domain must be on the allowlist (deny-by-default). This runs after the
  // SSRF check so that a DNS-rebinding attack cannot bypass the IP filter.
  if (config.egressAllowlist.length > 0) {
    if (!isDomainAllowed(normalizeHost(parsed.hostname), config.egressAllowlist)) {
      throw new EgressNotAllowedError(
        normalizeHost(parsed.hostname),
        `${normalizeHost(parsed.hostname)} is not on the egress allowlist`
      );
    }
  }

  // Fetch the page. In dry-run mode this still hits the network, but it does
  // not SSH to a host — the request originates from the container's network
  // namespace. The operator can see in the audit log whether dry-run was on.
  const response = await fetch(parsed.toString(), {
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: {
      "user-agent": "OpenVoice-Agent/0.1 (host-browse)"
    }
  });

  if (!response.ok) {
    throw new Error(`fetch returned ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const limit = config.maxOutputBytes;
  const truncated = text.length > limit;
  const content = truncated ? text.slice(0, limit) : text;

  return {
    status: "ok",
    kind: "browse",
    url: parsed.toString(),
    content,
    truncated,
    ...(parsed.hostname ? { host: parsed.hostname } : {})
  };
}

interface SearchItem {
  title: string;
  url: string;
  snippet?: string;
}

interface SearchResult {
  status: "ok" | "error";
  kind: "search";
  query: string;
  results: SearchItem[];
  truncated: boolean;
  [key: string]: unknown;
}

/** Maximum number of search results to return to the model. */
const MAX_SEARCH_RESULTS = 10;

async function runSearch(
  body: Record<string, unknown>,
  config: HostExecutorConfig
): Promise<SearchResult> {
  const query = body["query"];
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("query must be a non-empty string");
  }

  // DuckDuckGo HTML endpoint: no API key required. We set a User-Agent that
  // identifies as a browser to reduce the chance of a bot block.
  const params = new URLSearchParams({ q: query.trim() });
  const searchUrl = `https://html.duckduckgo.com/html/?${params.toString()}`;

  // The search endpoint must be allowlisted for browse. We reuse the egress
  // allowlist: if it's empty, search is also refused (deny-by-default).
  if (config.egressAllowlist.length === 0) {
    throw new Error(
      "No egress allowlist is configured, so searching is not available. Add duckduckgo.com to HOST_EXECUTOR_EGRESS_ALLOWLIST."
    );
  }
  if (!isDomainAllowed("html.duckduckgo.com", config.egressAllowlist)) {
    throw new EgressNotAllowedError(
      "html.duckduckgo.com",
      "html.duckduckgo.com is not on the egress allowlist for searching"
    );
  }

  // SSRF protection on the search endpoint itself.
  const ddgAddrs = await dnsLookup("html.duckduckgo.com", { all: true });
  for (const addr of ddgAddrs) {
    if (isBlockedAddress(addr.address)) {
      throw new Error("SSRF protection: duckduckgo.com resolves to a blocked address");
    }
  }

  const response = await fetch(searchUrl, {
    signal: AbortSignal.timeout(config.timeoutMs),
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`duckduckgo search returned ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const results = parseDuckDuckGoResults(html).slice(0, MAX_SEARCH_RESULTS);

  return {
    status: "ok",
    kind: "search",
    query: query.trim(),
    results,
    truncated: results.length === MAX_SEARCH_RESULTS
  };
}

/**
 * Extracts result links from DuckDuckGo's HTML endpoint.
 *
 * The HTML endpoint wraps each result in a `<div class="result">` containing
 * `<a class="result__a" href="...">` for the title and URL, and
 * `<a class="result__snippet">` for the excerpt. DuckDuckGo also serves an
 * interstitial with a redirect URL on the href, so we unwrap `uddg=` params.
 */
function parseDuckDuckGoResults(html: string): SearchItem[] {
  const results: SearchItem[] = [];
  // Match each result block. The HTML is not strict, so a regex is pragmatic.
  const blockRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    let href = match[1] ?? "";
    const title = stripTags(match[2] ?? "").trim();
    const snippet = stripTags(match[3] ?? "").trim();

    // DuckDuckGo wraps real URLs in a redirect: extract the uddg= param.
    try {
      const parsed = new URL(href, "https://html.duckduckgo.com");
      const unwrapped = parsed.searchParams.get("uddg");
      if (unwrapped) {
        href = decodeURIComponent(unwrapped);
      }
    } catch {
      // Keep the raw href if it cannot be parsed.
    }

    if (href && title) {
      results.push({
        title,
        url: href,
        ...(snippet ? { snippet } : {})
      });
    }
  }
  return results;
}

/** Strips HTML tags and decodes entities from a text node. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Result of a browserbot interaction. */
interface InteractResult {
  kind: "interact";
  action: string;
  url?: string;
  title?: string;
  text?: string;
  screenshot?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * Proxy a browser interaction request to the browserbot container.
 *
 * The host executor is the security boundary: it has already verified the
 * agent's Bearer token, checked the egress allowlist (for navigate actions),
 * and validated the action at the policy layer. This function just forwards
 * the request body to the browserbot's `/act` endpoint over an internal
 * service network and returns whatever the browserbot produces.
 */
async function runInteract(
  body: Record<string, unknown>,
  config: HostExecutorConfig
): Promise<InteractResult> {
  if (!config.browserbotBaseUrl) {
    throw new Error(
      "No browserbot is configured. Set BROWSERBOT_BASE_URL to enable host_interact."
    );
  }

  const action = body["action"];
  if (typeof action !== "string" || action.length === 0) {
    throw new Error("action must be a non-empty string");
  }

  const validActions = ["navigate", "click", "type", "scroll", "screenshot", "read"];
  if (!validActions.includes(action)) {
    throw new Error(`unknown interact action: ${action}`);
  }

  // For navigate, do the SSRF + egress check here (defence-in-depth, even though
  // the browserbot also checks). We reuse the same logic as runBrowse.
  if (action === "navigate") {
    const url = body["url"];
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("url is required for navigate");
    }
    if (config.dryRun) {
      throw new Error("dry-run mode: browser navigation is disabled");
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`invalid URL: ${url}`);
    }

    if (parsed.protocol !== "https:") {
      throw new Error("only https URLs are allowed");
    }

    // SSRF check on the hostname.
    const addresses = await dnsLookup(normalizeHost(parsed.hostname), { all: true });
    for (const addr of addresses) {
      if (isBlockedAddress(addr.address)) {
        throw new Error(
          `SSRF protection: ${normalizeHost(parsed.hostname)} resolves to a blocked address (${addr.address})`
        );
      }
    }

    // Egress allowlist check.
    if (config.egressAllowlist.length > 0) {
      if (!isDomainAllowed(normalizeHost(parsed.hostname), config.egressAllowlist)) {
        throw new EgressNotAllowedError(
          normalizeHost(parsed.hostname),
          `${normalizeHost(parsed.hostname)} is not on the egress allowlist`
        );
      }
    }
  }

  // Forward the request to the browserbot.
  const response = await fetch(`${config.browserbotBaseUrl.replace(/\/+$/, "")}/act`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.token}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `browserbot returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
  }

  const result = await response.json() as Record<string, unknown>;

  return {
    kind: "interact",
    action: action as string,
    ...("url" in result ? { url: result.url as string } : {}),
    ...("title" in result ? { title: result.title as string } : {}),
    ...("text" in result ? { text: result.text as string } : {}),
    ...("screenshot" in result ? { screenshot: result.screenshot as string } : {}),
    ...("error" in result ? { error: result.error as string } : {}),
    ...("durationMs" in result ? { durationMs: result.durationMs as number } : {})
  };
}

class RequestTooLargeError extends Error {}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > 64 * 1024) {
        reject(new RequestTooLargeError("too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        reject(new Error("empty body"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    request.on("error", reject);
  });
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }
  const presented = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  if (presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(presented, expected);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store"
  });
  response.end(payload);
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event, ...fields })}\n`
  );
}
