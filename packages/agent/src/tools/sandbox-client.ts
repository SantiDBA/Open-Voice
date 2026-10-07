/**
 * The agent's client for the sandbox action API.
 *
 * It does one thing the plain `fetch` call would not: when the caller aborts —
 * the user speaking over the agent, or the turn being cut — it also tells the
 * sandbox to cancel that action. Without that, aborting the HTTP request would
 * only stop waiting; the command would keep running in the container.
 */

export class SandboxError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

export interface SandboxOutcome {
  actionId: string;
  status: "ok" | "error" | "timeout" | "cancelled";
  kind: string;
  [key: string]: unknown;
}

export interface SandboxClient {
  /** Runs one action. Rejects with `SandboxError("aborted")` on abort. */
  run(
    body: Record<string, unknown>,
    actionId: string,
    signal: AbortSignal
  ): Promise<SandboxOutcome>;
  /** Best-effort cancel. Never throws. */
  cancel(actionId: string): Promise<void>;
  /** Whether the action API answers. Used once at startup to warn early. */
  probe(): Promise<boolean>;
}

export interface SandboxClientOptions {
  baseUrl: string;
  token?: string;
  /**
   * Path one action is posted to. The sandbox takes `{ kind, … }` on
   * `/actions`; the host executor takes `{ command, … }` on `/exec`. Everything
   * else — the credential, the timeout grace, cancelling a running action on
   * abort — is identical, which is why this is one client and not two.
   */
  actionPath?: string;
  /**
   * How long to wait past the remote's own ceiling before giving up on the
   * socket. The remote already bounds the command; this only covers a remote
   * that stops answering altogether.
   */
  graceMs?: number;
}

export function createSandboxClient(options: SandboxClientOptions): SandboxClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const graceMs = options.graceMs ?? 15_000;
  const actionPath = options.actionPath ?? "/actions";

  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
  });

  return {
    async run(body, actionId, signal) {
      const combined = combineWithTimeout(signal, graceMs);
      // Firing the cancel on abort is what actually stops the command.
      const onAbort = (): void => {
        void this.cancel(actionId);
      };
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        const response = await fetch(`${base}${actionPath}`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
          signal: combined.signal
        });

        const payload = (await response.json().catch(() => null)) as
          | (SandboxOutcome & { error?: string; code?: string })
          | null;

        if (!response.ok) {
          throw new SandboxError(
            payload?.code ?? `http_${response.status}`,
            payload?.error ?? `the sandbox answered ${response.status}`
          );
        }
        if (!payload) {
          throw new SandboxError("invalid_response", "the sandbox sent no JSON body");
        }
        return payload;
      } catch (error) {
        if (signal.aborted) {
          throw new SandboxError("aborted", "the action was interrupted");
        }
        if (error instanceof SandboxError) {
          throw error;
        }
        throw new SandboxError(
          "unreachable",
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        signal.removeEventListener("abort", onAbort);
        combined.dispose();
      }
    },

    async cancel(actionId) {
      // A fresh, short-lived signal: the caller's is already aborted.
      const short = combineWithTimeout(new AbortController().signal, 2_000);
      try {
        await fetch(`${base}${actionPath}/${encodeURIComponent(actionId)}/cancel`, {
          method: "POST",
          headers: headers(),
          signal: short.signal
        });
      } catch {
        // Best effort by design: the action may already have finished.
      } finally {
        short.dispose();
      }
    },

    async probe() {
      const short = combineWithTimeout(new AbortController().signal, 3_000);
      try {
        const response = await fetch(`${base}/healthz`, { signal: short.signal });
        return response.ok;
      } catch {
        return false;
      } finally {
        short.dispose();
      }
    }
  };
}

/**
 * A signal that fires when the caller's does or when `ms` elapses, whichever
 * comes first. Written out rather than using `AbortSignal.any`/`timeout` so it
 * does not depend on a lib version.
 */
function combineWithTimeout(
  signal: AbortSignal,
  ms: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();

  if (signal.aborted) {
    controller.abort();
  }
  const forward = (): void => controller.abort();
  signal.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(forward, ms);

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
    }
  };
}
