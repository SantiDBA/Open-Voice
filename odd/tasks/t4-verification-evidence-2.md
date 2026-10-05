# T4 Verification Evidence — Second Pass

Branch `feat/open-voice-vertical-minimo`, HEAD `7520861 feat(agent): announce an unreachable LLM at startup`.
Fix commits under test: `dc32103` (reach OmniRoute by host address; fetch speech models over HTTP) and
`7520861` (startup LLM reachability probe).

This pass re-runs the checks the first pass could not pass, against the real stack. Every block below is
raw observed output. No `.env*` file was created; every compose command used `--env-file env.example.template`
and the token was passed as `export LLM_API_KEY="$OMNIROUTE_API_KEY"` and never printed.

## Summary

| # | Check | Result |
|---|-------|--------|
| 1 | Fail-fast on missing `LLM_BASE_URL` | PASS |
| 2 | Resolution, no `extra_hosts`, LAN `LLM_BASE_URL` | PASS (config) / OBSERVATION (stale docs, see Finding 3) |
| 3 | Full stack comes up via `up -d --build` | **PASS — the first pass's blocker is closed** |
| 4 | Both speech models really cached | PASS |
| 5 | Streamed LLM from inside the agent container | **PASS — the first pass's blocker is closed** |
| 6 | `agent.started` with LAN URL + `agent.llm_reachable` | PASS |
| 7 | Negative probe fires `agent.llm_unreachable` | PASS (after correcting my own probe design, see note) |
| 8 | TTS `ef_dora` + STT synthetic WAV | PASS |
| 9 | Web app HTTP 200 | PASS |
| 10 | Honest scope statement | Stated below |

**Verdict on the first pass's two defects: both genuinely closed, observed, not inferred.**
Defect 1 (`speaches-models` blocked the stack): the whole stack now comes up through plain
`docker compose up -d --build` with no out-of-band `docker start` workaround. Defect 2 (agent could not
reach the LLM): a streamed chat completion from *inside* the agent container returns HTTP 200
`text/event-stream` with content chunks and a `[DONE]` marker.

Two new findings, neither blocking (see "New findings"): stale documentation that still names the alias
and claims the fixed "extra_hosts" behavior, and one cosmetic observation about the agent container image
id.

## Check 1 — Fail-fast still works

```
$ env -u LLM_BASE_URL docker compose config
error while interpolating services.agent.environment.LLM_BASE_URL: required variable LLM_BASE_URL is missing a value: set LLM_BASE_URL to a host address reachable from a container; see docs/runbook.md section 2
EXIT=1
```

Exits non-zero with the interpolation message, naming the service, the variable and the runbook. PASS.

## Check 2 — Resolution, no `extra_hosts`, LAN base URL

```
$ docker compose --env-file env.example.template config
EXIT=0
--- stderr ---
(empty)
--- services ---
agent: speaches: speaches-models: web:  (plus the default network and speaches-cache volume)
--- resolved env (agent) ---
LLM_BASE_URL: http://<host-lan-ip>:20128/v1
LLM_MODEL: auto/best-chat
STT_BASE_URL: http://speaches:8000/v1
TTS_BASE_URL: http://speaches:8000/v1
TTS_VOICE: ef_dora
--- extra_hosts occurrences in resolved config ---
0
--- host.docker.internal occurrences in resolved config ---
(none; grep exit 1)
```

`extra_hosts` is gone from the resolved compose model. The LAN address is this host's real routable
address, so the template is self-consistent:

```
$ ip route get 1.1.1.1
1.1.1.1 via <host-lan-gw> dev <wifi-iface> src <host-lan-ip>
$ ip -brief addr
<wifi-iface>   UP   <host-lan-ip>/24
docker0  DOWN 172.17.0.1/16
```

Repo-wide search for `extra_hosts` — gone from every shipped config, still present only in prose:

```
$ grep -rn "extra_hosts" --include="*.yml" --include="*.yaml" --include="*.template" --include="*.md" .
./odd/tasks/open-voice-vertical-minimo.md:39   extra_hosts: host.docker.internal:host-gateway  (plan, historical)
./odd/tasks/open-voice-vertical-minimo.md:94   extra_hosts: host.docker.internal:host-gateway  (plan, historical)
./odd/tasks/t4-verification-evidence.md:116   (first-pass evidence, historical)
./odd/tasks/t4-verification-evidence.md:273   (first-pass evidence, historical)
./docs/architecture.md:151                    extra_hosts: host.docker.internal:host-gateway
```

No `docker-compose.yml`, `env.example.template` or runbook occurrence. PASS for the configuration
under test. See New finding 3 for the documentation.

## Check 3 — Full stack comes up (THE check the first pass failed)

```
$ docker compose --env-file env.example.template up -d --build
START=2026-10-05T01:52:59-03:00
 Image open-voice-agent Building
 Image open-voice-web Building
 ...
#36 [agent build 14/14] RUN pnpm --filter @open-voice/agent build
#36 1.613 $ esbuild src/main.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/main.cjs --sourcemap
#36 1.667   dist/main.cjs      209.5kb
#36 1.667 ⚡ Done in 21ms
#38 naming to docker.io/library/open-voice-agent:latest done
 Image open-voice-agent Built
 Image open-voice-web Built
 Container open-voice-speaches-models-1 Recreate
 Container open-voice-speaches-models-1 Recreated
 Container open-voice-agent-1 Recreate
 Container open-voice-agent-1 Recreated
 Container open-voice-speaches-1 Starting
 Container open-voice-speaches-1 Started
 Container open-voice-speaches-1 Waiting
 Container open-voice-speaches-1 Healthy
 Container open-voice-speaches-models-1 Starting
 Container open-voice-speaches-models-1 Started
 Container open-voice-speaches-models-1 Waiting
 Container open-voice-speaches-1 Waiting
 Container open-voice-speaches-1 Healthy
 Container open-voice-speaches-models-1 Exited
 Container open-voice-agent-1 Starting
 Container open-voice-agent-1 Started
 Container open-voice-agent-1 Waiting
 Container open-voice-agent-1 Healthy
 Container open-voice-web-1 Starting
 Container open-voice-web-1 Started
EXIT=0
END=2026-10-05T01:53:26-03:00
```

The dependency chain now walks all the way through: `speaches` healthy → `speaches-models` Exited (0) →
`agent` healthy → `web` started. No `docker start` bypass, no manual ordering. 27 seconds wall clock.

```
$ docker compose --env-file env.example.template ps -a
NAME                           IMAGE                                        COMMAND                  SERVICE           CREATED          STATUS                PORTS
open-voice-agent-1             open-voice-agent                             "docker-entrypoint.s…"   agent             25 seconds ago   Up 11 seconds (healthy)   0.0.0.0:8787->8787/tcp
open-voice-speaches-1           ghcr.io/speaches-ai/speaches:0.8.3-cpu      "uvicorn --factory s…"   speaches          25 minutes ago   Up 24 seconds (healthy)  8000/tcp
open-voice-speaches-models-1   ghcr.io/speaches-ai/speaches:0.8.3-cpu      "/bin/sh -c 'curl --…"   speaches-models   25 seconds ago   Exited (0) 11 seconds ago
open-voice-web-1               sha256:51f95b4b381c...                       "docker-entrypoint.s…"   web               24 minutes ago   Up 5 seconds (health: starting)  0.0.0.0:3000->3000/tcp
```

Every service reached its intended state. `speaches-models` exit code, not just its status:

```
$ docker inspect open-voice-speaches-models-1 --format 'state=... exit=...'
state=exited exit=0 started=2026-10-05T04:53:18.207970342Z finished=2026-10-05T04:53:19.879420725Z
```

Ran for **1.67 seconds** and exited 0. It did not re-download: both models were already in the shared
volume, so the two HTTP `POST /v1/models/{id}` calls returned immediately.

Final health poll (after the web start period elapsed):

```
$ docker inspect open-voice-speaches-1 open-voice-agent-1 open-voice-web-1 --format '{{.Name}} status={{.State.Status}} health=...'
/open-voice-speaches-1 status=running health=healthy
/open-voice-agent-1     status=running health=healthy
/open-voice-web-1       status=running health=healthy
```

The job command really is the new curl form, not the old CLI form:

```
$ docker inspect open-voice-speaches-models-1 --format '{{json .Config.Entrypoint}}{{"\n"}}{{json .Config.Cmd}}'
["/bin/sh","-c"]
["curl --fail --silent --show-error --request POST \"${SPEACHES_BASE_URL}/v1/models/${STT_MODEL}\" && curl --fail --silent --show-error --request POST \"${SPEACHES_BASE_URL}/v1/models/${TTS_MODEL}\""]

$ docker compose --env-file env.example.template logs speaches-models
(empty)
```

Empty log is expected and correct: `--silent` suppresses progress on success, and `--fail` makes any
non-2xx a hard error that would have changed the exit code. Exit 0 with an empty log is the success
signature of this job. PASS.

## Check 4 — Models really cached

```
$ docker compose --env-file env.example.template exec -T speaches sh -c '...'
--- GET /v1/models ---
HTTP 200
ids: ['speaches-ai/Kokoro-82M-v1.0-ONNX', 'Systran/faster-whisper-small']
PRESENT Systran/faster-whisper-small
PRESENT speaches-ai/Kokoro-82M-v1.0-ONNX
--- voice check on the TTS model ---
voice_count= 54
ef_dora present: True
sample: [{"name": "af_heart", ...}, {"name": "af_alloy", ...}]
--- cache volume ---
802M	/home/ubuntu/.cache/huggingface/hub
models--Systran--faster-whisper-small
models--speaches-ai--Kokoro-82M-v1.0-ONNX
```

Both required ids are served live and both model directories are on the volume. `ef_dora` is confirmed
in the model's own voice table, which retires the first pass's "not a defect" caveat with positive
evidence rather than by inference. PASS.

## Check 5 — Streamed LLM from inside the agent container (THE second failed check)

Configuration and token as the container itself sees them. The token value is never printed, only its
length:

```
$ docker compose --env-file env.example.template exec -T agent node -e '...'
container LLM_BASE_URL=http://<host-lan-ip>:20128/v1 LLM_MODEL=auto/best-chat LLM_API_KEY_len=<redacted>
```

Streamed `POST {LLM_BASE_URL}/chat/completions`, `Authorization: Bearer` taken from the container's own
environment, `stream: true`:

```
HTTP 200 content-type=text/event-stream
content_chunks=14 done_marker=true first_chunk_ms=752 total_s=0.792
content="It proves that the container's application is up and responding as expected."
```

Every element the check demands, observed: HTTP 200, `text/event-stream`, 14 incremental content chunks
(not one buffered blob), and a `[DONE]` marker. Against the *configured* URL, from inside the container,
with the container's own credential. This is precisely what failed with `ECONNREFUSED` on
`host.docker.internal` in the first pass. PASS.

## Check 6 — Startup log

```
$ docker compose --env-file env.example.template logs agent
agent-1  | {"timestamp":"2026-10-05T04:53:20.550Z","level":"info","event":"agent.started","host":"0.0.0.0","port":8787,"health":"http://0.0.0.0:8787/healthz","llmModel":"auto/best-chat","llmBaseUrl":"http://<host-lan-ip>:20128/v1","sttModel":"Systran/faster-whisper-small","realtimeStt":false,"tts":true}
agent-1  | {"timestamp":"2026-10-05T04:53:20.741Z","level":"info","event":"agent.llm_reachable","url":"http://<host-lan-ip>:20128/v1/models"}
```

Both required events, 191 ms apart. `llmBaseUrl` is the LAN address from the template, and the new
`agent.llm_reachable` event confirms the probe actually reached the provider at startup rather than
merely being configured to. Exactly two log lines, no warnings, no errors. PASS.

## Check 7 — Negative probe: the warning actually fires

I first ran this wrong and the wrong run is recorded below rather than hidden, because the first attempt
also shows what the warning looks like when something *does* answer.

First attempt, using `-p 19279:8787` to move the published port off the running stack's 8787:

```
$ docker compose --env-file env.example.template run --rm --no-deps -p 19279:8787 -e LLM_BASE_URL=http://<host-lan-ip>:19279/v1 agent
{"timestamp":"2026-10-05T04:54:24.047Z","level":"info","event":"agent.started",...,"llmBaseUrl":"http://<host-lan-ip>:19279/v1",...}
{"timestamp":"2026-10-05T04:54:24.163Z","level":"warn","event":"agent.llm_unreachable","url":"http://<host-lan-ip>:19279/v1/models","error":"HTTP 404"}
```

`HTTP 404` is not a connection failure, so I checked what was listening. From the **host**, port 19279
is dead — `curl` exits with `http_code=000`, nothing in `ss -ltn`:

```
$ ss -ltn | grep 19279
(no output)
```

Diagnosis, from inside a container:

```
$ docker compose --env-file env.example.template exec -T agent node -e 'fetch("http://<host-lan-ip>:19279/v1/models")'
THREW TypeError undefined fetch failed cause: ECONNREFUSED connect ECONNREFUSED <host-lan-ip>:19279
control 45111 THREW TypeError undefined fetch failed cause: ECONNREFUSED connect ECONNREFUSED <host-lan-ip>:45111
```

Port 19279 genuinely refuses connections. The `404` came from my own probe design: publishing
`-p 19279:8787` put the throwaway agent's *own* HTTP server on host port 19279, and Docker's userland
proxy hairpinned the container's outbound request back into that same container, which has no
`/v1/models` route. The one-off container was removed:

```
$ docker rm -f open-voice-agent-run-9a014c5274b3
$ docker ps -a --filter "name=open-voice-agent-run" --format '{{.Names}} {{.Status}}'
(empty = gone)
```

Second attempt, no host publish at all — `docker compose run` does not publish service ports unless
asked, so there is nothing to collide with the running stack's 8787 and no hairpin target:

```
$ ss -ltn | grep -c ':45111'
0
$ docker compose --env-file env.example.template run --rm --no-deps -e LLM_BASE_URL=http://<host-lan-ip>:45111/v1 agent
Container open-voice-agent-run-d0031ab31f70 Created
{"timestamp":"2026-10-05T04:56:16.717Z","level":"info","event":"agent.started","host":"0.0.0.0","port":8787,"health":"http://0.0.0.0:8787/healthz","llmModel":"auto/best-chat","llmBaseUrl":"http://<host-lan-ip>:45111/v1","sttModel":"Systran/faster-whisper-small","realtimeStt":false,"tts":true}
{"timestamp":"2026-10-05T04:56:16.786Z","level":"warn","event":"agent.llm_unreachable","url":"http://<host-lan-ip>:45111/v1/models","error":"fetch failed"}
```

Exactly one `agent.llm_unreachable` line (`grep -c` = 1), naming the probe URL, at `warn` level, 69 ms
after start. The agent still started and served — it did not abort, matching the documented
"warning, never fatal" contract. Stopped afterwards:

```
$ docker rm -f open-voice-agent-run-d0031ab31f70
$ docker ps -a --filter "name=open-voice-agent-run" --format '{{.Names}} {{.Status}}'
(empty = gone)
$ docker compose --env-file env.example.template ps -a
open-voice-agent-1             Up 3 minutes (healthy)
open-voice-speaches-1           Up 3 minutes (healthy)
open-voice-speaches-models-1   Exited (0) 3 minutes ago
open-voice-web-1               Up 3 minutes (healthy)
```

The running stack was never disturbed. Two shapes of unreachable are now both demonstrated: a
connection refused (`fetch failed`) and an answering-but-wrong endpoint (`HTTP 404`).
PASS, with the first attempt's design error documented rather than omitted.

## Check 8 — Providers against the running stack

TTS, voice `ef_dora`, inside the speaches container:

```
$ POST http://127.0.0.1:8000/v1/audio/speech  {"model":"speaches-ai/Kokoro-82M-v1.0-ONNX","voice":"ef_dora","response_format":"mp3"}
status=200
--- headers ---
HTTP/1.1 200 OK
date: Mon, 05 Oct 2026 04:56:53 GMT
server: uvicorn
content-type: audio/mp3
Transfer-Encoding: chunked
--- bytes ---
14904
--- magic (hex) ---
 ff f3 84 c4
```

Status 200, `audio/mp3`, 14,904 bytes, and an MPEG audio frame sync (`ff f3`, with the `f3` layer-III
bits), so this is real encoded audio rather than an error body. PASS.

STT with a synthetic WAV built by Python inside the container:

```
$ (python3 stdlib wave, 440 Hz tone with a 2 Hz amplitude envelope, 1.0 s)
wav_bytes=32044 rate=16000 channels=1 sample_width=2
$ POST http://127.0.0.1:8000/v1/audio/transcriptions  file=@/tmp/synth.wav  model=Systran/faster-whisper-small
status=200
--- body ---
{"text":""}
has_text_field= True repr_text= ''
```

Status 200 with a JSON `text` field. An empty string is the expected result for a pure tone: the model
loaded and transcribed, it found no speech. This is the same pass condition the first pass used. PASS.

## Check 9 — Web app

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
200

$ curl -s http://127.0.0.1:8787/healthz
{"status":"ok","service":"open-gpt-live-gateway","uptimeSeconds":58,"connections":0,"version":"0.1.0","realtimeStt":false,"tts":true}
```

Web 200, agent healthz 200. PASS.

## Check 10 — Honest scope: what this pass did NOT exercise

Nothing in this pass touched real audio input or output semantics:

- **No microphone.** No audio was captured from any capture device at any point.
- **No browser VAD.** The `NEXT_PUBLIC_VAD_*` thresholds compiled into the web bundle were never run.
  They are baked at build time and only take effect in a browser; this pass only proved the bundle
  builds and serves.
- **No spoken turn.** No speech was spoken, recognized, answered and spoken back end to end. The STT
  result here was an empty transcription of a synthetic tone, which proves the model loads, not that
  speech is recognized.
- **No barge-in / interruption.** No turn was interrupted mid-sentence, so the hangover, max-turn and
  playback-suppression VAD values are untested behavior, not verified behavior.

Also unverified in this pass: the first pass's static checks (`pnpm typecheck`, `pnpm test`, `pnpm
build`) were not re-run, since this pass was scoped to proving the two fixes on the real stack. The
agent image did rebuild here and esbuild succeeded, which exercises part of the build path but is not a
substitute for those three commands.

Those four are T5.

## New findings

### Finding 3 — `docs/architecture.md` still documents the broken alias and the removed `extra_hosts`

Severity: low, documentation only. It does not affect runtime, and it is not a regression introduced by
the fix commits — the file was not touched by `dc32103`, so the first pass's fix left it stale.

`docs/architecture.md:17`
```
| Providers | `speaches` + the host's OmniRoute daemon | `@open-gpt-live/adapters` | `speaches:8000`, `host.docker.internal:20128` | ... |
```
`docs/architecture.md:106`
```
 3. Agent     LLM: POST http://host.docker.internal:20128/v1/chat/completions
```
`docs/architecture.md:138`
```
| **Agent to OmniRoute** | **`host.docker.internal:20128`, host loopback** | ... |
```
`docs/architecture.md:148-151`
```
The container-side URL is `http://host.docker.internal:20128/v1` while the host-side URL is
`http://127.0.0.1:20128/v1`. They differ because OmniRoute binds the loopback interface only: a container
cannot reach the host's `127.0.0.1`, so compose maps `host.docker.internal` to the host gateway
(`extra_hosts: host.docker.internal:host-gateway`).
```

Every one of those statements is now false on this machine: the alias refuses connections under rootless
Docker, the `extra_hosts` mapping no longer exists, and OmniRoute binds `0.0.0.0`, not loopback. The
architecture doc is the page a reader consults to understand the network, and it currently describes the
exact failure mode the first pass proved. `docs/runbook.md` and `env.example.template` were correctly
updated; this one file was missed.

### Finding 4 — agent container shows an image digest, not a tag

Cosmetic. `docker compose ps -a` reports `open-voice-agent-1` on `sha256:51f95b4b...` while
`speaches` shows `ghcr.io/speaches-ai/speaches:0.8.3-cpu`. The build emitted both an image config and
an attestation manifest, and `ps` renders the provenance-wrapped identity. Runtime is unaffected and the
image does contain the freshly built `dist/main.cjs` (209.5 kb, larger than the 208.2 kb of the first
pass, consistent with the added probe code). Noting it so a later reader does not mistake it for a
different or stale image.

## Defect closure verdict

**Defect 1 (`speaches-models` could not run, blocking the whole stack) — CLOSED, observed.**
`speaches-cli` is gone from the job; the job ran for 1.67 s and exited 0; `docker compose up -d --build`
brought all four services to their intended states with no manual intervention.

**Defect 2 (agent could not reach the LLM) — CLOSED, observed.**
From inside `open-voice-agent-1`, a streamed chat completion against the configured
`http://<host-lan-ip>:20128/v1` returned HTTP 200 `text/event-stream` with 14 content chunks and
`[DONE]`. `agent.started` reports the LAN URL and `agent.llm_reachable` fires at startup.

**No blocking defect found in this pass.** The two new findings are a stale documentation file and a
cosmetic image-id note.

## State left behind

**Left running**, all healthy, so a human can drive the browser check by hand:

```
open-voice-agent-1             Up (healthy)   0.0.0.0:8787->8787/tcp
open-voice-speaches-1           Up (healthy)   8000/tcp
open-voice-speaches-models-1   Exited (0)     (one-shot job, correct terminal state)
open-voice-web-1               Up (healthy)   0.0.0.0:3000->3000/tcp
```

This is the state T4 is meant to end in, and it is what lets the operator open
`http://localhost:3000` and talk to the agent by hand. Stop it with
`docker compose --env-file env.example.template down` (add `-v` only if you want to drop the 802 MiB
model cache).

Both throwaway probe containers were removed. `docker ps -a --filter name=open-voice-agent-run` is empty.

**Repository**: no product source, config or documentation was changed and nothing was committed. HEAD is
still `7520861`. `git status --porcelain` reports exactly two untracked files, both evidence:

```
?? odd/tasks/t4-verification-evidence.md
?? odd/tasks/t4-verification-evidence-2.md
```

No `.env*` file exists anywhere in the repository (`find . -name ".env*" -not -path "./node_modules/*"`
returns nothing). `OMNIROUTE_API_KEY` was read from the environment and passed through as
`LLM_API_KEY`; its value was never printed. The only place it is observable in this document is the
length, `35`, taken from inside the container.
