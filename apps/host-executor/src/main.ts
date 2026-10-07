import { loadHostExecutorConfig } from "./config.js";
import { createHostExecutor } from "./server.js";

/**
 * The host executor: a process you start yourself, on your machine, that runs
 * one allowed command at a time when the agent asks for one and you have
 * approved it in the UI.
 *
 * It exists because the sandbox cannot touch the host, and the agent should not
 * be able to either by default. Starting this is the act that grants that
 * ability; stopping it takes the ability away. Nothing starts it for you.
 */
async function main(): Promise<void> {
  const config = loadHostExecutorConfig();
  const executor = await createHostExecutor(config);

  if (config.allowedCommands.length === 0) {
    log("host_executor.warning", {
      detail:
        "HOST_EXECUTOR_ALLOWED_COMMANDS is empty, so every command is refused. Add patterns to allow any."
    });
  }

  let shuttingDown = false;
  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("host_executor.stopping", { signal });
    await executor.close();
    log("host_executor.stopped", { signal });
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
      event: "host_executor.start_failed",
      error: error instanceof Error ? error.message : String(error)
    })}\n`
  );
  process.exitCode = 1;
});
