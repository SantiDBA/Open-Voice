import { loadBrowserbotConfig } from "./config.js";
import { createBrowserbot } from "./server.js";

/**
 * The browserbot: a stateful browser automation service for the agent's
 * host_interact tool. Runs headless Chromium via Playwright, with SSRF
 * protection and egress allowlist enforcement on every navigation.
 *
 * It is a separate container, only reachable on an internal Docker network.
 * The host executor proxies /interact requests to it after its own auth and
 * SSRF checks.
 */
async function main(): Promise<void> {
  const config = loadBrowserbotConfig();
  const bot = await createBrowserbot(config);

  if (config.dryRun) {
    log("browserbot.warning", {
      detail:
        "BROWSERBOT_DRY_RUN is true (default). Navigation to external sites is disabled."
    });
  }

  let shuttingDown = false;
  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("browserbot.stopping", { signal });
    await bot.close();
    log("browserbot.stopped", { signal });
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
      event: "browserbot.start_failed",
      error: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
});
