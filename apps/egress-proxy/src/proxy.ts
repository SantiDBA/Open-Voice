import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";

import { isBlockedAddress, isDomainAllowed, normalizeHost } from "./allowlist.js";
import type { EgressProxyConfig } from "./config.js";

export interface EgressProxyHandle {
  readonly port: number;
  close(): Promise<void>;
}

type Decision = { ok: true; address: string } | { ok: false; reason: string };

/**
 * The sandbox's only route out.
 *
 * It is an ordinary forward proxy — HTTPS goes through `CONNECT`, plain HTTP
 * through an absolute-URI request — with one rule: a connection is made only
 * when the name is on the allowlist *and* every address it resolves to is
 * public. The allowance decision is made once and the connection is then opened
 * against the address that was checked, never against a fresh lookup, so a
 * name cannot pass the check and then resolve somewhere else.
 *
 * The sandbox sits on an internal network with no route out, so reaching this
 * proxy is the only way anything leaves the sandbox. That is enforced by Docker,
 * not by trusting the sandbox's own configuration.
 */
export async function createEgressProxy(
  config: EgressProxyConfig
): Promise<EgressProxyHandle> {
  const server = http.createServer();

  server.on("request", (request, response) => {
    void forwardHttp(request, response, config);
  });

  server.on("connect", (request, clientSocket, head) => {
    void forwardConnect(request, clientSocket, head, config);
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
    throw new Error("Egress proxy did not bind to a TCP port");
  }

  log("egress.started", {
    port: address.port,
    allowedDomains: config.allowedDomains,
    defaultPolicy: config.allowedDomains.length === 0 ? "deny_all" : "allowlist"
  });

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

/** HTTPS and anything else tunnelled: `CONNECT host:port`. */
async function forwardConnect(
  request: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  config: EgressProxyConfig
): Promise<void> {
  const target = parseAuthority(request.url ?? "");
  if (!target) {
    deny(clientSocket, 400, "Bad Request", "bad_authority");
    return;
  }

  const decision = await decide(target.host, config);
  if (!decision.ok) {
    log("egress.denied", {
      mode: "connect",
      host: target.host,
      port: target.port,
      reason: decision.reason
    });
    deny(clientSocket, 403, "Forbidden", decision.reason);
    return;
  }

  const upstream = net.connect(target.port, decision.address, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    log("egress.allowed", {
      mode: "connect",
      host: target.host,
      port: target.port,
      address: decision.address
    });
  });

  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
}

/** Plain HTTP: the request carries an absolute URI. */
async function forwardHttp(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  config: EgressProxyConfig
): Promise<void> {
  let url: URL;
  try {
    url = new URL(request.url ?? "");
  } catch {
    respondJson(response, 400, "bad_request");
    return;
  }

  if (url.protocol !== "http:") {
    respondJson(response, 400, "unsupported_scheme");
    return;
  }

  const host = normalizeHost(url.hostname);
  const port = url.port.length > 0 ? Number(url.port) : 80;
  const decision = await decide(host, config);
  if (!decision.ok) {
    log("egress.denied", { mode: "http", host, port, reason: decision.reason });
    respondJson(response, 403, decision.reason);
    return;
  }

  const proxied = http.request(
    {
      host: decision.address,
      port,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: { ...request.headers, host: url.host }
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers
      );
      upstreamResponse.pipe(response);
      log("egress.allowed", {
        mode: "http",
        host,
        port,
        address: decision.address,
        status: upstreamResponse.statusCode
      });
    }
  );

  proxied.on("error", () => {
    if (!response.headersSent) {
      respondJson(response, 502, "upstream_failed");
    } else {
      response.end();
    }
  });

  request.pipe(proxied);
}

/**
 * The single decision: is this name allowed, and does it resolve only to public
 * addresses? A name that resolves to any blocked address is refused outright —
 * choosing the public one would make the check race the resolver.
 */
async function decide(host: string, config: EgressProxyConfig): Promise<Decision> {
  const name = normalizeHost(host);
  if (!isDomainAllowed(name, config.allowedDomains)) {
    return { ok: false, reason: "domain_not_allowed" };
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(name, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
  if (records.length === 0) {
    return { ok: false, reason: "dns_failed" };
  }

  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      return { ok: false, reason: "blocked_address" };
    }
  }

  return { ok: true, address: records[0]!.address };
}

/** `host:port`, or a bare host that defaults to 443. */
export function parseAuthority(
  value: string
): { host: string; port: number } | null {
  if (value.length === 0) {
    return null;
  }

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end === -1) {
      return null;
    }
    const host = value.slice(1, end);
    const rest = value.slice(end + 1);
    const port = rest.startsWith(":") ? Number(rest.slice(1)) : 443;
    return isPort(port) && host.length > 0 ? { host, port } : null;
  }

  const separator = value.lastIndexOf(":");
  if (separator === -1) {
    return { host: value, port: 443 };
  }
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  return isPort(port) && host.length > 0 ? { host, port } : null;
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65_535;
}

function deny(socket: Duplex, status: number, text: string, reason: string): void {
  const body = JSON.stringify({ error: reason });
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\n` +
      "content-type: application/json; charset=utf-8\r\n" +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      "connection: close\r\n\r\n" +
      body
  );
  socket.end();
}

function respondJson(
  response: http.ServerResponse,
  status: number,
  reason: string
): void {
  const body = JSON.stringify({ error: reason });
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event, ...fields })}\n`
  );
}
