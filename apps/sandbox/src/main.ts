import fs from "node:fs";

import { loadSandboxConfig } from "./config.js";
import { createSandboxServer } from "./server.js";

/**
 * The sandbox action server: the process that runs commands and touches files
 * on the agent's behalf, confined to one directory.
 *
 * It owns one job — execute exactly what it is asked, inside the workspace, and
 * say honestly what happened. Policy (what may be asked at all) belongs to the
 * agent; enforcement of the boundary belongs here.
 */
async function main(): Promise<void> {
  const config = loadSandboxConfig();

  // The workspace must exist before the server listens, or every action would
  // fail its first path resolution.
  fs.mkdirSync(config.workspace, { recursive: true });

  const server = await createSandboxServer(config);

  log("sandbox.started", {
    host: config.host,
    port: server.port,
    workspace: config.workspace,
    actionTimeoutMs: config.actionTimeoutMs,
    maxOutputBytes: config.maxOutputBytes
  });

  let shuttingDown = false;
  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("sandbox.stopping", { signal });
    await server.close();
    log("sandbox.stopped", { signal });
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
      event: "sandbox.start_failed",
      error: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
});
