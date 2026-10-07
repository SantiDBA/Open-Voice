# Third-party notices

This repository vendors third-party source code. This file records what was vendored, from where, at
which revision, and what was changed locally afterwards.

## Vendored project: open-gpt-live

| Field | Value |
| --- | --- |
| Project | open-gpt-live |
| Upstream repository | https://github.com/study8677/open-gpt-live |
| Vendored revision | `dd905efed6e0b04675b4c37f302815ca050adef3` |
| Vendored tag | none — upstream publishes no tags, so `v0.2.0` could not be checked out. The revision is the only public commit of the repository and is equivalent to the `0.2.0` version declared in `package.json`. |
| Upstream version | `0.2.0` |
| License | MIT — see [`LICENSE.open-gpt-live`](./LICENSE.open-gpt-live), copied verbatim from upstream. The root [`LICENSE`](./LICENSE) covers this project's own code and is a separate grant. |
| Copyright | Copyright (c) 2026 OpenGPT Live contributors, as recorded in `LICENSE.open-gpt-live`. |

### Relationship to upstream

This is a **vendored copy, not a git fork**. There is no shared git history with upstream, no
`upstream` remote, and no upstream branch tracked here. Upstream commits are adopted by copying files
into this repository, one commit at a time, with the vendored revision recorded in this file and in the
commit message. The upstream directory layout is preserved so the upstream pnpm workspace, build and
test commands keep working unchanged.

#### Licensing

The vendored copy stays under its own MIT grant and keeps its copyright notice verbatim in
`LICENSE.open-gpt-live`, which the MIT license requires for substantial portions. The root `LICENSE`
is a separate MIT grant covering only what this project wrote: `packages/agent/`, `odd/`, `docs/`,
`README.md`, `THIRD_PARTY.md`, `Dockerfile.agent`, `docker-compose.yml`, `env.example.template` and
the root configuration. The two grants do not conflict, and neither imposes a requirement on the
other.

## Vendored files

The following paths are copies of upstream files. They are byte-identical to upstream unless listed
in the next section.

```
.gitignore                             (locally adjusted, see below)
package.json                           (locally modified, see below)
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.base.json
LICENSE.open-gpt-live
README.md
Dockerfile.gateway
Dockerfile.web
apps/gateway/package.json
apps/gateway/tsconfig.json
apps/gateway/src/config.ts
apps/gateway/src/config.test.ts
apps/gateway/src/environment.ts
apps/gateway/src/environment.test.ts
apps/gateway/src/gateway.ts
apps/gateway/src/gateway.test.ts
apps/gateway/src/logger.ts
apps/gateway/src/protocol.test.ts
apps/gateway/src/server.ts
apps/web/package.json
apps/web/tsconfig.json
apps/web/next.config.mjs
apps/web/next-env.d.ts
apps/web/app/globals.css
apps/web/app/icon.svg
apps/web/app/layout.tsx
apps/web/app/page.tsx
apps/web/lib/audio-pcm.ts
apps/web/lib/audio-pcm.test.ts
apps/web/lib/latency-metrics.ts
apps/web/lib/latency-metrics.test.ts
apps/web/lib/live-config.ts
apps/web/lib/live-config.test.ts
apps/web/lib/request-lifecycle.ts
apps/web/lib/request-lifecycle.test.ts
apps/web/lib/vad-engine.ts
apps/web/lib/vad-engine.test.ts
apps/web/public/vad-worklet.js
packages/adapters/package.json
packages/adapters/tsconfig.json
packages/adapters/src/index.ts
packages/adapters/src/index.test.ts
packages/adapters/src/streaming-stt.ts
packages/adapters/src/streaming-stt.test.ts
packages/protocol/package.json
packages/protocol/tsconfig.json
packages/protocol/src/index.ts
```

Upstream test files are vendored together with their sources; they were not trimmed.

### Upstream files deliberately not vendored

`output/`, `assets/`, `.github/`, `scripts/`, `README.zh-CN.md`, `CHANGELOG.md`,
`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `TODO.md`, `.dockerignore`,
`.env.local-ai.example`, `docker-compose.yml` and `.env.example` were left out: they are upstream
project assets, upstream-only documentation, or files this project replaces with its own runtime
configuration. Nothing inside `apps/` or `packages/` was pruned.

### Locally modified upstream files

Exactly eight upstream files have been changed since they were copied. Every other vendored file is
untouched upstream source.

| File | Local changes |
| --- | --- |
| `package.json` | Renamed the root workspace package from `open-gpt-live` to `open-voice`. Added `@open-voice/agent`, `@open-voice/exec`, and the new `apps/` service packages to the `dev`, `build` and `start` workspace filters. Removed the `local-ai:check` script, which invoked the non-vendored upstream `scripts/check-local-ai.mjs`. `engines.node`, `packageManager`, `typecheck`, `test` and `check` are unchanged. |
| `.gitignore` | Kept the upstream entries and reordered them into commented groups. Added `.env.*.local` and `workspace/` (the optional host bind-mount target for the sandbox workspace). No vendored source directory is ignored. |
| `apps/gateway/package.json` | Added an `exports` map so `@open-voice/agent` can import `createGatewayServer`, `createJsonLogger` and `loadProjectEnvironment`. Upstream gateway code, scripts and dependencies are unchanged. |
| `pnpm-lock.yaml` | Regenerated by `pnpm install` to record new workspace importers (`apps/browserbot`, `apps/egress-proxy`, `apps/host-executor`, `apps/sandbox`, `packages/exec`) and the `playwright` dependency pulled in by `apps/browserbot`. The resolved dependency graph for existing importers is otherwise unchanged. |
| `README.md` | Replaced upstream's README entirely. This file now describes Open Voice. Upstream's project description, quickstart, provider-compatibility table and documentation index pointed at files that are not vendored here (`TODO.md`, `docs/protocol.md`, `docs/local-ai.md`, the upstream logo and screenshot under `output/` and `assets/`, the Chinese README, and the Ollama-based local AI profile), so keeping it would have misdescribed what this repository is. Upstream is credited and described in `THIRD_PARTY.md` and in `docs/architecture.md`. |
| `Dockerfile.web` | Added `NEXT_PUBLIC_TOOLS_WS_URL` as a build `ARG` and `ENV`, so the browser can be built to connect to the tool channel WebSocket. No other stage or instruction is touched. |
| `apps/web/app/globals.css` | Reset `--size-body` to `0.9375rem` directly on `body` (never `html`) so the rem base stays 16 px — the previous `font-size` on `html` inflated the whole type scale by 12.5%. Set the shell to exactly `100dvh` with `min-height: 0` so the plot absorbs leftover viewport space without scrolling. Added the tool-activity panel, gate-panel and `TOOL`/`GATE` log-row styles. Compactened the type scale and spacing to fit the first viewport. |
| `apps/web/app/page.tsx` | Replaced the playback surface's `HTMLAudioElement` with an `AudioBufferSourceNode` through the Web Audio graph so the agent's own voice is measured, not guessed (M3). Added the tool-channel WebSocket client, the on-screen approval gate (panel fixed above the composer, Deny focused by default), and `TOOL`/`GATE`/`EXEC` log kinds in the activity log. Added the `ActivePlayback` interface, `PLOT_TRACE_COLOURS` (trace coloured by phase, red reserved for a cut), and a compact viewport layout. |

### Local additions absent from upstream

These paths do not exist upstream and are original work licensed with this repository:

- `packages/agent/` — the `@open-voice/agent` package: the agent config, persona, providers and
  composition root that run on top of the vendored gateway, plus the agentic tool subsystem
  (`packages/agent/src/tools/`: the `ToolLoopLlmProvider` loop, tool registry, policy, audit, and
  sandbox/host clients) and the browser tool channel (`packages/agent/src/tool-channel.ts`).
- `packages/exec/` — the `@open-voice/exec` package: command execution with output bounding and
  workspace path confinement (`resolveInside`, `WorkspaceEscapeError`), shared by the sandbox and
  host executor.
- `Dockerfile.agent` — runtime image for `@open-voice/agent`, in the same multi-stage shape as
  upstream's `Dockerfile.gateway`, copying only the bundled `dist` into a non-root runtime stage.
- `Dockerfile.sandbox` — image for the sandbox action-execution server, based on a Debian-slim
  image with bash, git, node, python3, ripgrep and curl, running as a non-root user.
- `Dockerfile.egress-proxy` — image for the egress allowlist proxy that gives the sandbox its only
  route out of its internal Docker network.
- `Dockerfile.host-executor` — image for the host executor, extending the sandbox base image.
- `Dockerfile.browserbot` — image for the headless-browser automation service used by
  `host_interact`.
- `apps/sandbox/` — the sandbox action-execution server (`@open-voice/sandbox`): `exec`,
  `read_file`, `write_file`, `edit_file`, `list_dir`, cancellation by `actionId`, confinable to
  `/workspace`, bearer-authenticated.
- `apps/egress-proxy/` — the egress allowlist proxy: validates the destination host against
  `SANDBOX_ALLOWED_DOMAINS` and rejects loopback, private, link-local, multicast and metadata
  addresses (SSRF defence).
- `apps/host-executor/` — the host escalation executor (`@open-voice/host-executor`): a process
  the operator starts on the host, auth-gated, with a command allowlist, shell-metacharacter
  rejection, path confinement, and dry-run mode.
- `apps/browserbot/` — a headless-browser service that the host executor proxies to for
  `host_interact` actions (navigate, click, type, scroll, screenshot, read).
- `docker-compose.yml` — the Open Voice hybrid stack: `agent`, `web`, `speaches`, the one-shot
  `speaches-models` download job, plus the agentic-actions services (`sandbox`, `sandbox-gateway`,
  `egress-proxy`, `host-executor`). Upstream's compose file is Ollama-based and was not vendored.
- `env.example.template` — the hybrid configuration profile, tracked with placeholder values only.
  It replaces upstream's `.env.example`, which was not vendored. The name avoids the `.env*` path
  pattern that tooling in this workflow classifies as sensitive and refuses to write; copy it with
  `cp env.example.template .env`. The real `.env` stays git-ignored.
- `docs/architecture.md`, `docs/runbook.md` — Open Voice architecture and operating documentation,
  including the agentic tools topology, trust boundary, and sandbox operation. Upstream's `docs/`
  was not vendored.
- `apps/web/lib/tool-channel.ts` — the browser-side WebSocket client for the tool channel: connects
  to `ws://localhost:8788`, receives tool activity events and sends approval decisions. A new file
  in the upstream `apps/web/lib/` directory, which upstream does not have.
- `odd/` — feature planning and verification documents, including
  `odd/tasks/open-voice-agentic-actions.md`.
- `THIRD_PARTY.md` — this file.