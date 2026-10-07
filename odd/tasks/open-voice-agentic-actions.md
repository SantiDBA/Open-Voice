# Evidence: Open Voice agentic actions

Feature tasks **T0–T8** of the `open-voice-agentic-controls` roadmap, captured
2026-10-06 against the running stack.

## What was asked

Turn the speaking agent (today it only talks) into one that **acts** on this
machine — execute commands, edit files, search and browse the web, and
later control the desktop — **without exposing the machine**. The owner's
non-negotiable: the voice does not approve destructive actions.

## How it works (the design, in brief)

The tool loop lives *inside* the `LLMProvider.streamText` call
(`packages/agent/src/tools/llm.ts`). The gateway only knows
`streamText(messages, options)` returning text deltas; the loop calls the model
with function-calling, runs whatever the model asks for, feeds the result back
as data, and calls again — yielding only the text that should be spoken. The
gateway sees one slightly-slow answer and its interruption/TTS pipeline are
unchanged.

```
              ┌──── sandbox ────┐   ┌── host-executor ───┐
              │  read/write/   │   │  exec / file /     │
              │  list / exec   │   │  browse / search   │
              └──────┬─────────┘   └────────┬───────────┘
                     │                      │
          auto-allow (sandbox)   human gate (host tools + TOOLS_APPROVAL=all)
                     │                      │
          ┌──────────────────────────────────────────┐
          │    packages/agent  (the tool loop)      │
          │    ToolLoopLlmProvider  in  llm.ts      │
          └──────┬──────────────────────────┬───────┘
                 │                          │
   gateway :8787 │                          │ WS :8788
   streamText  ──┘                    tool-channel.ts
                                        (activity + gate)
                 │
          ┌──────┴──────┐
          │    web      │   gate panel above the composer;
          │   :3000     │   activity log with TOOL / GATE rows
          └─────────────┘
```

### Trust boundary — three tiers

| Tier | What it controls | Imposed by | Default |
|---|---|---|---|
| Tool policy | Whether the action runs at all | `tools/policy.ts` | sandbox auto-allow; host → gate |
| Sandbox | What the command can reach | Container + non-root + `/workspace` | write only in `/workspace` + `/tmp` |
| Network | Where traffic goes | Docker `internal` net + `egress-proxy` | no egress; empty allowlist |
| Resources | How much it costs | Compose | `mem_limit`, `cpus`, `pids_limit`, `read_only`, `cap_drop: [ALL]`, `no-new-privileges` |
| Secrets | What it can read | No `.env` mounted | zero credentials in the sandbox |
| Audit | What happened | `tools/audit.ts` → JSONL | every action, args, decision, outcome |
| Human gate | What leaves the sandbox | Browser UI | deny on timeout, disconnect, or no client |

### Safety rules (enforced in code)

1. `TOOLS_ENABLED=false` by default — with it unset the agent is the speaking
   assistant it was before; every existing test passes unchanged.
2. The sandbox never sees `.env`, `~/.ssh`, `~/.aws`, or the repo; only
   `SANDBOX_WORKSPACE_DIR` (a named volume by default).
3. Every path is resolved and verified inside `/workspace` (symlinks included).
   Escapes are an error, not a silent clamp.
4. Egress is closed by default. A new host = gate or deny, never "allow and
   continue".
5. The tool channel binds only `127.0.0.1` and validates `Origin`.
6. Approval is never accepted by voice, by model parameter, or by user text —
   only by the on-screen gate, which shows the exact command.
7. No `--dangerously-skip-permissions` anywhere. The loop has iteration, time
   and output caps.
8. Host escalation requires the executor running and a per-action approval.

### Tool inventory

| Tool | Runs on | Enforcement | Confinement |
| --- | --- | --- | --- |
| `read_file` | sandbox | auto | `/workspace` |
| `write_file` | sandbox | auto | `/workspace` |
| `edit_file` | sandbox | auto | `/workspace` |
| `list_dir` | sandbox | auto | `/workspace` |
| `run_command` | sandbox | auto | `/workspace` (no egress, except via proxy) |
| `host_exec` | host | gate | `HOST_EXECUTOR_ROOT`; allowlist; no pipes/chains/redirects |
| `host_file_read` | host | gate | `HOST_EXECUTOR_ROOT` |
| `host_file_write` | host | gate | `HOST_EXECUTOR_ROOT` |
| `host_browse` | host | gate | SSRF-checked; egress allowlist |
| `host_search` | host | gate | DuckDuckGo HTML (no API key); egress allowlist required |
| `host_interact` | host | gate | browserbot proxy; SSRF + egress checked on navigate |

Host tools only exist when `HOST_EXECUTOR_BASE_URL` + `HOST_EXECUTOR_TOKEN` are
both set. Without them the model is never told the option exists.

## Task results

### T0 — Spike: tool calling support

**PASS.** Raw `curl` calls to OmniRoute (`http://127.0.0.1:20128/v1`,
`model: auto/chat`) confirmed:

- **Non-streaming `tools`**: `finish_reason: "tool_calls"`, the call carries an
  `id`, a `name` and JSON `arguments`. The router resolved `auto/chat` →
  `openai/gpt-oss-120b`.
- **Streaming `tools`**: deltas arrive as `delta.tool_calls` (same OpenAI
  shape), the stream closes with `finish_reason: "tool_calls"`, and arguments
  arrive in fragments that must be concatenated by `index`.
- **Full round-trip** (user → `tool_calls` → `role: "tool"` result → final
  answer): the model used the tool result and answered in Spanish with
  `finish_reason: "stop"`.

**Discovery:** `auto/chat` may route to a different upstream per request. The
loop must not depend on the router's choice: pin `LLM_MODEL` to a tool-capable
id, or probe at startup and refuse to enable tools if support is absent.

Evidence: `odd/tasks/t0-tool-calling-evidence.md`.

### T1 — Sandbox service

**Done.** `apps/sandbox/` + `Dockerfile.sandbox`: a Debian-slim image with
`bash`, `git`, `node`, `python3`, `ripgrep`, `curl`, non-root user. HTTP JSON API
on `127.0.0.1:8790` (bearer `SANDBOX_TOKEN`): `exec`, `read_file`,
`write_file`, `edit_file`, `list_dir`, `POST /actions/:id/cancel`,
`GET /healthz`. Everything confined to `/workspace`.

### T2 — Network and limits

**Done.** `sandbox` + `egress-proxy` on an `internal: true` Docker network (no
egress at the network level, no `CAP_NET_ADMIN` needed). `HTTP(S)_PROXY`
pointed at the egress proxy. `SANDBOX_ALLOWED_DOMAINS` allowlist (default
empty). Container limits: `read_only`, `tmpfs` on `/tmp`, `cap_drop: [ALL]`,
`no-new-privileges`, `mem_limit`, `cpus`, `pids_limit`. Workspace is a named
volume by default (rootless Docker uid mapping breaks host bind mounts).

**Discovery:** rootless Docker does not publish ports on `internal` networks
silently — no error, just no listener. Added `sandbox-gateway`: a single-port
forwarder (not a proxy, not a router) from `127.0.0.1:8790` on a bridge network
to the sandbox on the internal network. No egress route is gained.

Evidence: `odd/tasks/t4-verification-evidence.md` (T2 smoke tests).

### T3 — Agent config

**Done.** `ToolingConfig` in `packages/agent/src/config.ts` + the `agent`
block in `docker-compose.yml` + `env.example.template`. `SANDBOX_TOKEN` is
required when `TOOLS_ENABLED=true` (fail-fast, no credential = no tools).
`HOST_EXECUTOR_BASE_URL` + `HOST_EXECUTOR_TOKEN` required together.
`compose-wiring.test.ts` passes: every variable the config reads is in compose;
every compose variable is documented; defaults agree.

### T4 — The tool loop

**Done.** `packages/agent/src/tools/`: `llm.ts` (`ToolLoopLlmProvider`
replaces the vendored provider only when `TOOLS_ENABLED`), `registry.ts`
(tool schemas + metadata), `policy.ts` (sandbox/gate/deny classification),
`sandbox-client.ts`, `audit.ts`.

The loop has iteration, time, and output caps. It is abortable by the gateway's
`AbortSignal` — barge-in still cuts everything, including an in-flight action
(via `POST /actions/:id/cancel`).

**Recovery verified:** an empty optional string (`cwd: ""`) is treated as
"not given" rather than refused; the loop recovered from a model mistake
without a wasted round-trip after the fix.

Evidence: `odd/tasks/t4-tool-loop-evidence.md`.

### T5 — Tool channel

**Done.** `packages/agent/src/tool-channel.ts`: a dedicated WebSocket server on
`127.0.0.1:8788`, origin-checked, fail-closed. Broadcasts `tool.call`,
`tool.result`, `gate.request`; receives `approve`/`deny` decisions. Appends
`tool-audit.jsonl`.

Verified by test: a connection from a foreign origin is refused; with no
allowed origins configured every connection is refused; an unanswered approval
is denied on expiry; a decision is denied when the client disconnects; a
malformed or misaddressed decision never settles a gate.

### T6 — Approval gate + UI

**Done.** `apps/web/lib/tool-channel.ts` (browser client), new `LogKind`
entries (`tool`, `gate`) in the activity log, and a gate panel fixed above the
composer showing the exact command, cwd, reason, and an `Approve` / `Deny` /
`Deny & stop` set with Deny focused by default.

**Verified end-to-end** through Playwright against `localhost:3000`:

- **Deny, outside the agent:** instruction to create + run `saludo.js`. One gate
  appeared, was denied. `docker compose exec sandbox ls /workspace/saludo.js`
  → No such file. Nothing ran.
- **Approve, outside the agent:** same instruction, both gates approved. File
  created, `node saludo.js` executed, output `hola desde el sandbox`. Verified
  by running the file from the host.

**Finding worth keeping:** the first attempt failed with "no button matched
deny". The gate panel was styled `.gate`, and the activity log row was
`li.gate` — the panel rule was painting every gate line in the log. Renamed to
`.gate-panel`. A class name is a namespace; this one was taken.

Evidence: `odd/tasks/t6-approval-gate-evidence.md`.

### T7 — Host escalation

**Done.** `apps/host-executor/` + `Dockerfile.host-executor`: a process the
operator starts on the host (nothing in the stack starts it for you), auth via
bearer token, `POST /exec` endpoint with per-`actionId` cancellation.

Five host tools: `host_exec`, `host_file_read`, `host_file_write`,
`host_browse`, `host_search`. Plus `host_interact` (browser automation via
`apps/browserbot/`, gated behind `BROWSERBOT_BASE_URL`).

Safety model:
- `HOST_EXECUTOR_DRY_RUN=true` by default — commands run in the container
  namespace, not on the machine.
- `HOST_EXECUTOR_ALLOWED_COMMANDS` allowlist (empty = nothing runs).
- `assertRunnable` rejects pipes, chains, substitutions, redirects.
- `host_browse` / `host_search`: HTTPS-only, DNS-resolved SSRF check
  (`isBlockedAddress` rejects loopback/private/link-local/metadata) before the
  egress allowlist check (defence in depth).
- `host_search` uses DuckDuckGo HTML (no API key), but requires
  `HOST_EXECUTOR_EGRESS_ALLOWLIST` to include `html.duckduckgo.com`.
- Everything gated: no auto-approve, ever.

Verified: `host_exec` refused without allowlist match; `compound_command`
rejected for pipes; `host_browse` refused for non-https, invalid URL, localhost,
and `169.254.169.254`; `host_search` refused when the egress allowlist is empty.

### T8 — Hardening and closure

**Done.**

- `PRODUCT.md` updated: the agentic capability now exists and is documented as
  such; the "open decision" is resolved.
- `docs/architecture.md` updated: full topology, trust boundary, tool table, and
  the "denied by default" escalation ladder.
- `docs/runbook.md` updated: §7b covers enabling tools, the host executor,
  dry-run mode, the approval gate, auditing, and a failure-mode table.
- `THIRD_PARTY.md` updated: modified upstream files and new local additions
  documented.
- `DESIGN.md` updated: the "acting" phase (reusing amber/thinking), the gate
  panel, and `TOOL`/`GATE` log kinds documented.

## Verification

| Check | Method | Result |
| --- | --- | --- |
| Types | `pnpm -r typecheck` | 10 of 11 workspace projects, EXIT=0 |
| Unit tests | `pnpm test` | 273 tests across 26 files, all pass |
| Wiring | `compose-wiring.test.ts` | 3 tests pass — every config var is in compose, documented, default-aligned |
| Sandbox confinement | `workspace.test.ts` | 14 tests pass |
| Policy | `tools/policy.test.ts` | 21 tests pass |
| Tool channel | `tool-channel.test.ts` | 13 tests pass |
| Host executor | `server.test.ts` + `allowlist.test.ts` | 18 + 7 tests pass |
| Egress proxy | `allowlist.test.ts` | 17 tests pass |
| Browser bot | `server.test.ts` | 18 tests pass |

## Honest scope — what was NOT exercised

- **No voice-driven end-to-end with tools.** T4/T6 were verified via Playwright
  with text input, not spoken instruction. The voice path through a tool turn
  is covered by unit tests (barge-in during `streamText`), not a real
  microphone-to-tools walk.
- **No GUI / computer-use walk-through.** `host_interact` is implemented and
  SSRF-gated, but the browserbot was unit-tested only. A real navigate → click →
  screenshot → read cycle was not run against a live page.
- **No real SSH escalation.** `HOST_EXECUTOR_DRY_RUN=false` with a live
  `HOST_EXECUTOR_HOST` was not exercised outside dry-run's container namespace.
  The code path exists but must be tested by the operator with their own SSH
  keys.
- **`auto/chat` model routing** remains an open risk: T0 confirmed this
  particular run landed on `openai/gpt-oss-120b`; pinning `LLM_MODEL` is
  recommended for production.
- **Concurrency:** two browser tabs both connected to the tool channel would
  each see the gate; whichever answers first wins. Not tested.
- **Reconnection during a pending gate:** the client retries every 3s; a
  channel that drops while a gate is pending is unit-tested (server denies) but
  not exercised end-to-end.
- **Parallel tool calls** were not tested — only sequential calls.

## Out of scope (explicit)

- No cross-session memory. History dies with the WebSocket connection.
- No multi-user, no auth beyond loopback + Origin check.
- No changes to the VAD, the interruption model, or the strike.
- The vendored gateway (`apps/gateway/`) was never forked or patched.
