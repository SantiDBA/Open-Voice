import { createSandboxClient, type SandboxClient } from "./sandbox-client.js";

/**
 * The agent's client for the host executor.
 *
 * It is the same client as the sandbox's with a different path, on purpose: the
 * two differ in what they ask for and who answers, not in how a request is
 * made, credentialed, bounded and cancelled. The one thing that matters and is
 * easy to get wrong — cancelling the running action at the far end when the
 * turn is interrupted — lives in one place.
 *
 * The host executor is an opt-in process the operator starts themselves. When
 * it is not running, requests fail and the tool reports that, which is exactly
 * the honest outcome.
 */
export interface HostClientOptions {
  baseUrl: string;
  token?: string;
  graceMs?: number;
}

export function createHostClient(options: HostClientOptions): SandboxClient {
  return createSandboxClient({ ...options, actionPath: "/exec" });
}
