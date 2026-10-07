import net from "node:net";

/**
 * A one-port TCP forwarder, and nothing else.
 *
 * It exists because a container on an internal Docker network cannot have a
 * published port, and the sandbox must stay on an internal network to have no
 * route out. So the sandbox is reached through this: the forwarder sits on the
 * internal network and on a normal one, listens on the published port, and
 * pipes bytes to the sandbox. It is not a proxy and not a router — it opens one
 * fixed destination and carries no traffic anywhere else, so the sandbox gains
 * no egress through it.
 *
 * The action API behind it still authenticates with its own bearer token; this
 * adds a door, not a key.
 */
interface ForwardConfig {
  listenHost: string;
  listenPort: number;
  targetHost: string;
  targetPort: number;
}

function loadForwardConfig(env: NodeJS.ProcessEnv = process.env): ForwardConfig {
  return {
    listenHost: nonEmpty(env.FORWARD_LISTEN_HOST) ?? "0.0.0.0",
    listenPort: parsePort(env.FORWARD_LISTEN_PORT, 8790, "FORWARD_LISTEN_PORT"),
    targetHost: nonEmpty(env.FORWARD_TARGET_HOST) ?? "sandbox",
    targetPort: parsePort(env.FORWARD_TARGET_PORT, 8790, "FORWARD_TARGET_PORT")
  };
}

function parsePort(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function main(): void {
  const config = loadForwardConfig();

  const server = net.createServer((client) => {
    const upstream = net.connect(config.targetPort, config.targetHost);
    // Half-close aware: piping both ways and letting either end finish is what
    // makes an HTTP request/response survive the hop.
    client.pipe(upstream);
    upstream.pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });

  server.on("error", (error) => {
    log("forward.failed", { error: error.message });
    process.exitCode = 1;
  });

  server.listen(config.listenPort, config.listenHost, () => {
    log("forward.started", {
      listen: `${config.listenHost}:${config.listenPort}`,
      target: `${config.targetHost}:${config.targetPort}`
    });
  });

  let shuttingDown = false;
  const stop = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("forward.stopping", { signal });
    server.close(() => log("forward.stopped", { signal }));
  };

  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event, ...fields })}\n`
  );
}

main();
