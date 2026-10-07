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

export interface HostClient extends SandboxClient {
  /** Adds a domain to the host executor's egress allowlist at runtime. */
  addEgressDomain(domain: string): Promise<void>;
}

export function createHostClient(options: HostClientOptions): HostClient {
  const base = createSandboxClient({ ...options, actionPath: "/exec" });
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const token = options.token;

  return {
    ...base,
    async addEgressDomain(domain: string): Promise<void> {
      const response = await fetch(`${baseUrl}/allowlist`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ domain })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          `Could not add ${domain} to the allowlist: ${payload?.error ?? response.status}`
        );
      }
    }
  };
}
