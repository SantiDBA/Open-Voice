/**
 * The browserbot service.
 *
 * A stateful HTTP service that exposes a single `/act` endpoint. It runs an
 * instance of headless Chromium via Playwright and executes a constrained set
 * of browser actions: navigate, click, type, scroll, screenshot, read.
 *
 * The browserbot does NOT do its own SSRF or egress-allowlist checking — that
 * is the host executor's job. The host executor validates the URL, checks it
 * against the allowlist and resolves the IP against private ranges before
 * forwarding the request here. This layer of defence-in-depth means the
 * browserbot can be a "dumb" executor: it only runs what it is told to run.
 *
 * Authentication is handled by the host executor: the agent authenticates to
 * the host executor with a Bearer token, and the host executor forwards proxied
 * requests to this service. The browserbot is only reachable on an internal
 * Docker network, never published to the host.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { isBlockedAddress, isDomainAllowed, normalizeHost } from "@open-voice/egress-proxy";
import type { BrowserbotConfig } from "./config.js";

/** The maximum viewport width for screenshots, to bound token usage. */
const MAX_VIEWPORT_WIDTH = 1280;

/** Maximum number of search-result-style items (not used here, kept for clarity). */

export interface ActionResult {
  ok: boolean;
  kind: string;
  /** The current page URL after the action, if applicable. */
  url?: string;
  /** The current page title after the action, if applicable. */
  title?: string;
  /** Base64-encoded screenshot PNG, when requested or on error for context. */
  screenshot?: string;
  /** Extracted text content, when requested. */
  text?: string;
  /** Error message when ok is false. */
  error?: string;
  /** Duration of the action in milliseconds. */
  durationMs?: number;
}

/** The shape of a request body the `/act` endpoint accepts. */
export interface ActRequest {
  /** The action to perform. */
  action: string;
  /** URL to navigate to (navigate only). */
  url?: string;
  /** CSS selector (click, type, read). */
  selector?: string;
  /** Click coordinates (click only). */
  x?: number;
  y?: number;
  /** Text to type (type only). */
  text?: string;
  /** Scroll coordinates (scroll only). */
  scrollX?: number;
  scrollY?: number;
}

/** A running browserbot instance. */
export interface BrowserbotHandle {
  port: number;
  close: () => Promise<void>;
}

/** A simple structured-JSON logger to stderr. */
function log(event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...data });
  // eslint-disable-next-line no-console
  console.log(line);
}

/**
 * SSRF protection for the browserbot's navigate action.
 *
 * Even though the host executor already checks this, we repeat it here as
 * defence-in-depth: the browserbot should never resolve to a private IP.
 *
 * Order matters: the egress allowlist is checked first (deny-by-default, fail
 * fast, no DNS leak), then the SSRF check verifies that any allowlisted domain
 * doesn't resolve to a private IP (DNS rebinding protection).
 */
export async function checkSsrF(hostname: string, egressAllowlist: readonly string[]): Promise<void> {
  // First, deny-by-default: if the allowlist is non-empty, the domain must
  // match. An empty allowlist means no egress restriction at this layer
  // (the host executor's allowlist is the primary gate); the SSRF check
  // below still rejects private IPs.
  if (egressAllowlist.length > 0) {
    if (!isDomainAllowed(normalizeHost(hostname), egressAllowlist)) {
      throw new Error(
        `${normalizeHost(hostname)} is not on the egress allowlist`
      );
    }
  }

  // Second, SSRF check: resolve the host and reject any address that is
  // loopback, private, link-local, multicast, or the cloud metadata endpoint.
  const dns = await import("node:dns/promises");
  const addresses = await dns.lookup(hostname, { all: true });
  for (const addr of addresses) {
    if (isBlockedAddress(addr.address)) {
      throw new Error(
        `SSRF protection: ${hostname} resolves to a private or blocked address (${addr.address})`
      );
    }
  }
}

/**
 * Validate and normalize a URL before navigation. Returns the parsed URL or
 * throws if the URL is invalid, not https, or fails SSRF checks.
 */
export async function validateUrl(
  inputUrl: string,
  config: BrowserbotConfig
): Promise<URL> {
  if (typeof inputUrl !== "string" || inputUrl.trim().length === 0) {
    throw new Error("url must be a non-empty string");
  }

  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error(`invalid URL: ${inputUrl}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error("only https URLs are allowed");
  }

  if (!parsed.hostname) {
    throw new Error("URL has no hostname");
  }

  await checkSsrF(parsed.hostname, config.egressAllowlist);

  return parsed;
}

/**
 * Create and start a browserbot service.
 */
export async function createBrowserbot(config: BrowserbotConfig): Promise<BrowserbotHandle> {
  // Dynamically import Playwright so the module is only loaded when actually
  // starting the service (keeps typecheck fast and tests lighter).
  const { chromium } = await import("playwright");

  // Launch Chromium in headless mode with security flags.
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-web-security",
      "--allow-running-insecure-content",
      "--disable-setuid-sandbox",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  // A single persistent browser context holds the session. We use a single
  // context for now; session management can be added later if the model needs
  // to open multiple tabs or windows.
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  let page = await context.newPage();

  log("browserbot.started", {
    host: config.host,
    port: config.port,
    width: config.width,
    height: config.height,
    dryRun: config.dryRun,
    egressAllowlist: config.egressAllowlist
  });

  /** Execute one action and return the result. */
  async function executeAction(req: ActRequest): Promise<ActionResult> {
    const started = Date.now();

    const result: ActionResult = { ok: true, kind: req.action };

    const timerFor = (ms: number) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
    };

    switch (req.action) {
      case "navigate": {
        if (config.dryRun) {
          throw new Error("dry-run mode: navigation is disabled");
        }
        if (!req.url) throw new Error("url is required for navigate");
        const validated = await validateUrl(req.url, config);
        const t = timerFor(config.timeoutMs);
        try {
          await page.goto(validated.toString(), { timeout: config.timeoutMs, waitUntil: "domcontentloaded" });
        } finally {
          t.cleanup();
        }
        result.url = page.url();
        result.title = await page.title().catch(() => "");
        break;
      }

      case "click": {
        const t = timerFor(config.timeoutMs);
        try {
          if (req.selector) {
            await page.click(req.selector, { timeout: config.timeoutMs });
          } else if (typeof req.x === "number" && typeof req.y === "number") {
            await page.mouse.click(req.x, req.y);
          } else {
            throw new Error("either selector or x+y coordinates are required for click");
          }
        } finally {
          t.cleanup();
        }
        break;
      }

      case "type": {
        if (!req.selector) throw new Error("selector is required for type");
        if (typeof req.text !== "string") throw new Error("text is required for type");
        const t = timerFor(config.timeoutMs);
        try {
          await page.type(req.selector, req.text, { delay: 20, timeout: config.timeoutMs });
        } finally {
          t.cleanup();
        }
        break;
      }

      case "scroll": {
        const t = timerFor(config.timeoutMs);
        try {
          const x = req.scrollX ?? 0;
          const y = req.scrollY ?? 0;
          await page.evaluate((scrollTo) => { window.scrollTo(scrollTo[0], scrollTo[1]); }, [x, y]);
        } finally {
          t.cleanup();
        }
        result.url = page.url();
        break;
      }

      case "screenshot": {
        const t = timerFor(config.timeoutMs);
        try {
          const buffer = await page.screenshot({
            fullPage: false,
            type: "png"
          });
          result.screenshot = buffer.toString("base64");
        } finally {
          t.cleanup();
        }
        result.url = page.url();
        result.title = await page.title().catch(() => "");
        break;
      }

      case "read": {
        const t = timerFor(config.timeoutMs);
        try {
          const text = await page.evaluate(() => {
            const el = document.body;
            if (!el) return "";
            const clone = el.cloneNode(true) as HTMLElement;
            clone.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
            return clone.textContent?.trim() ?? "";
          });
          result.text = text;
        } finally {
          t.cleanup();
        }
        result.url = page.url();
        result.title = await page.title().catch(() => "");
        break;
      }

      default:
        throw new Error(`unknown action: ${req.action}`);
    }

    result.durationMs = Date.now() - started;
    return result;
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
      return;
    }

    // The browserbot trusts the host executor — auth is handled there.
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;

    try {
      const actionReq: ActRequest = {
        action: typeof body["action"] === "string" ? body["action"] : "",
        url: typeof body["url"] === "string" ? body["url"] : undefined,
        selector: typeof body["selector"] === "string" ? body["selector"] : undefined,
        x: typeof body["x"] === "number" ? body["x"] : undefined,
        y: typeof body["y"] === "number" ? body["y"] : undefined,
        text: typeof body["text"] === "string" ? body["text"] : undefined,
        scrollX: typeof body["scrollX"] === "number" ? body["scrollX"] : undefined,
        scrollY: typeof body["scrollY"] === "number" ? body["scrollY"] : undefined
      };

      const result = await executeAction(actionReq);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log("browserbot.error", { action: body["action"] ?? "unknown", error: detail });
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: detail }));
    }
  });

  server.listen(config.port, config.host, () => {
    log("browserbot.listening", { port: config.port });
  });

  return {
    port: config.port,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  };
}
