import { startAgent } from "./server.js";

startAgent().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "agent.start_failed",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exitCode = 1;
});