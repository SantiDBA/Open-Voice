/**
 * Composition root entry point for the Open Voice agent.
 *
 * The vendored `apps/gateway` package has no `exports` map, so importing its
 * internals follows the same explicit `.js` subpath convention that upstream
 * source uses between its own files.
 */
export {
  createGatewayServer,
  DEFAULT_MAX_AUDIO_TURN_BYTES,
  type GatewayLogger,
  type GatewayProviders,
  type GatewayServerHandle,
  type GatewayServerOptions
} from "@open-gpt-live/gateway/src/gateway.js";
export { createJsonLogger } from "@open-gpt-live/gateway/src/logger.js";
export {
  loadProjectEnvironment,
  resolveProjectEnvFile
} from "@open-gpt-live/gateway/src/environment.js";