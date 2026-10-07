import { loadEgressProxyConfig } from "./config.js";
import { createEgressProxy } from "./proxy.js";

/**
 * The sandbox's egress boundary. It allows nothing by default: every domain the
 * sandbox may reach is named in `EGRESS_ALLOWED_DOMAINS`, and an allowed name
 * still has to resolve to a public address.
 */
async function main(): Promise<void> {
  const config = loadEgressProxyConfig();
  const proxy = await createEgressProxy(config);

  let shuttingDown = false;
  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("egress.stopping", { signal });
    await proxy.close();
    log("egress.stopped", { signal });
  };

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event, ...fields })}\n`
  );
}

main().catch((error: unknown) => {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "egress.start_failed",
      error: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
});
