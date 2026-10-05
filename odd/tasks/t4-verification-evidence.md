# T4 Verification Evidence

## 1. Static checks

- **pnpm -r typecheck**
  ```
  Scope: 5 of 6 workspace projects
  packages/adapters typecheck$ tsc -p tsconfig.json
  packages/protocol typecheck$ tsc -p tsconfig.json
  packages/protocol typecheck: Done
  packages/adapters typecheck: Done
  apps/gateway typecheck$ tsc -p tsconfig.json
  apps/web typecheck$ tsc -p tsconfig.json
  apps/web typecheck: Done
  apps/gateway typecheck: Done
  packages/agent typecheck$ tsc -p tsconfig.json
  packages/agent typecheck: Done
  EXIT=0
  ```

- **pnpm test**
  ```
  Test Files  15 passed (15)
       Tests  105 passed (105)
     Duration  1.84s (transform 1.08s, setup 0ms, collect 2.27s, tests 683ms, environment 5ms, prepare 2.33s)
  EXIT=0
  ```

- **pnpm build**
  ```
  $ pnpm --filter @open-voice/agent build && pnpm --filter @open-gpt-live/gateway build && pnpm --filter @open-gpt-live/web build
  $ esbuild src/main.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/main.cjs --sourcemap
    dist/main.cjs      208.2kb
    dist/main.cjs.map  370.5kb
  ⚡ Done in 24ms
  $ esbuild src/server.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/server.cjs --sourcemap
    dist/server.cjs      205.0kb
    dist/server.cjs.map  362.2kb
  ⚡ Done in 18ms
  $ next build && cp -R .next/static .next/standalone/apps/web/.next/static && cp -R public .next/standalone/apps/web/public
    ▲ Next.js 14.2.35
      Creating an optimized production build ...
    ✓ Compiled successfully
    Linting and checking validity of types ...
    Collecting page data ...
    Generating static pages (0/5) ...
    Generating static pages (5/5)
    Finalizing page optimization ...
    Collecting build traces ...
  EXIT=0
  ```

## 2. Compose resolution

- `docker compose --env-file env.example.template config` resolved successfully.
- **Services**: `speaches-models`, `agent`, `speaches`, `web`
- **host.docker.internal mapping**: `host.docker.internal=host-gateway`
- **Hugging Face cache volume target**: `/home/ubuntu/.cache/huggingface/hub` on both `speaches` and `speaches-models`
- **Resolved environment** (agent service):
  ```
  LLM_BASE_URL: http://host.docker.internal:20128/v1
  STT_BASE_URL: http://speaches:8000/v1
  TTS_BASE_URL: http://speaches:8000/v1
  TTS_MODEL: speaches-ai/Kokoro-82M-v1.0-ONNX
  TTS_VOICE: ef_dora
  ALLOWED_ORIGINS: http://localhost:3000
  ```

## 3. Bring up the real stack

- **Overall**: FAIL. `docker compose up -d --build` built both images and started `speaches` (healthy),
  but `speaches-models` exited 2, so `agent` and `web` never started. Full output:
  ```
   Image open-voice-agent Built
   Image open-voice-web Built
   Network open-voice_default Created
   Volume open-voice_speaches-cache Created
   Container open-voice-speaches-1 Started
   Container open-voice-speaches-models-1 Started
   Container open-voice-speaches-models-1 Waiting

  $ docker compose --env-file env.example.template ps -a
  NAME                           IMAGE                                    STATUS
  open-voice-agent-1             open-voice-agent                         Created
  open-voice-speaches-1           ghcr.io/speaches-ai/speaches:0.8.3-cpu   Up 18 seconds (healthy)
  open-voice-speaches-models-1   ghcr.io/speaches-ai/speaches:0.8.3-cpu   Up 18 seconds
  open-voice-web-1               open-voice-web                           Created
  ```
  Cause and workarounds: see Defect 1 below.
- **Model download duration**: **107 seconds** measured for both models together, via the image's HTTP
  API. The compose job itself never downloaded anything (it exits before invoking a CLI).
  ```
  TTS_HTTP_DOWNLOAD_START=2026-10-05T01:31:50-03:00
  --- POST /v1/models/Systran/faster-whisper-small ---
  HTTP 200
  Model 'Systran/faster-whisper-small' downloaded
  --- POST /v1/models/speaches-ai/Kokoro-82M-v1.0-ONNX ---
  HTTP 200
  Model 'speaches-ai/Kokoro-82M-v1.0-ONNX' downloaded
  EXIT=0
  TTS_HTTP_DOWNLOAD_END=2026-10-05T01:33:37-03:00
  ELAPSED_SECONDS=107
  ```
  No memory pressure was observed during the download or the runs:
  `free -m` showed 5471 MiB available of 15860 MiB total, 8 cores.

## 4. Provider checks

- **LLM from host** (`POST http://127.0.0.1:20128/v1/chat/completions` with `stream:true`)
  ```
  [HTTP 200 time=0.830414s]
  [DONE]
  content_chunks=115
  ```

- **LLM from inside agent container (extra_hosts)** — **FAIL** on the configured URL:
  ```
  $ docker compose --env-file env.example.template exec -T agent node -e '<streamed fetch to host.docker.internal>'
        at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) {
          errno: -111,
          code: 'ECONNREFUSED',
          syscall: 'connect',
          address: '172.17.0.1',
          port: 20128
        }
  Node.js v22.23.3
  ```
  The exact same streamed request against the host LAN address succeeds, which isolates the fault to
  the `host-gateway` alias and not to the LLM or the container network:
  ```
  $ docker exec open-voice-agent-1 node -e '<streamed fetch to <host-lan-ip>>'
  HTTP 200 text/event-stream
  content_chunks=9 done_marker=true
  content="The container probe monitors the contents for safety."
  ```
  Full root-cause evidence: Defect 2 below.

- **STT model list** (inside Speaches container):
  ```
  HTTP 200
  {"data":[{"id":"speaches-ai/Kokoro-82M-v1.0-ONNX",...},{"id":"Systran/faster-whisper-small",...}]}
  --- required ids present? ---
  Systran/faster-whisper-small
  speaches-ai/Kokoro-82M-v1.0-ONNX
  --- cache volume ---
  802M	/home/ubuntu/.cache/huggingface/hub
  models--Systran--faster-whisper-small
  models--speaches-ai--Kokoro-82M-v1.0-ONNX
  ```

- **TTS** (inside Speaches container, voice `ef_dora`):
  ```
  HTTP 200
  --- headers ---
  HTTP/1.1 200 OK
  date: Mon, 05 Oct 2026 04:36:07 GMT
  server: uvicorn
  content-type: audio/mp3
  Transfer-Encoding: chunked
  --- bytes ---
  15936
  --- magic ---
  0000000 377 363 204 304
  ```
  **Pass condition**: 4 KB or larger audio body → 15,936 bytes ✓

- **STT** (inside Speaches container, synthetic WAV):
  ```
  wav_bytes=32044 rate=16000 channels=1 sample_width=2
  HTTP 200
  body {"text":""}
  text_field ''
  ```
  **Pass condition**: HTTP 200 with JSON `text` field ✓ (empty string expected for synthetic tone)

## 5. Agent health and configuration

- **Agent healthz** (`curl -s http://127.0.0.1:8787/healthz`):
  ```
  HTTP 200
  {"status":"ok","service":"open-gpt-live-gateway","uptimeSeconds":160,"connections":0,"version":"0.1.0","realtimeStt":false,"tts":true}
  ```

- **Agent startup log line** (shows container-side OmniRoute URL):
  ```
  {"timestamp":"2026-10-05T04:34:28.408Z","level":"info","event":"agent.started","host":"0.0.0.0","port":8787,"health":"http://0.0.0.0:8787/healthz","llmModel":"auto/best-chat","llmBaseUrl":"http://host.docker.internal:20128/v1","sttModel":"Systran/faster-whisper-small","realtimeStt":false,"tts":true}
  ```

- **Web app responsiveness** (`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/`):
  ```
  web HTTP 200
  ```

## 6. Honest assessment of what T4 does NOT prove

T4 does **not** exercise:
- Microphone input (no audio capture from host)
- Browser-based Voice Activity Detection (VAD)
- Spoken turn-taking (no end-to-end voice conversation)
- Interruption mid-sentence (no barge-in capability)

These are reserved for T5. T4 only validates provider plumbing and model availability.

## Defects found

### Defect 1 — `speaches-models` cannot run: `speaches-cli` does not exist in the pinned image

`docker compose --env-file env.example.template up -d --build` never brings the stack up. The
`speaches-models` job exits 2, so `agent` and `web` stay in `Created`.

Exact output:

```
=== inspect speaches-models state/exit ===
exited exit=2 started=2026-10-05T04:28:33.17401244Z finished=2026-10-05T04:28:54.433501083Z
--- full models log ---
Downloading piper-phonemize (14.4MiB)
 Downloading piper-phonemize
   Building speaches @ file:///home/ubuntu/speaches
      Built speaches @ file:///home/ubuntu/speaches
Uninstalled 1 package in 2ms
Installed 1 package in 3ms
error: Failed to spawn: `speaches-cli`
  Caused by: No such file or directory (os error 2)
```

Image inspection, proving the binary is absent rather than merely mis-pathed:

```
--- PATH: /home/ubuntu/speaches/.venv/bin:/home/ubuntu/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
--- uv tools ---
No tools installed
--- local bin ---
ls: cannot access '/home/ubuntu/.local/bin': No such file or directory
--- which speaches ---
(no output)

--- venv bin (excerpt) ---
... huggingface-cli ... normalizer ... phonemize ... piper ... tiny-agents ... uvicorn
(no `speaches`, no `speaches-cli`)

--- entry points ---
cat /home/ubuntu/speaches/.venv/lib/python3.12/site-packages/speaches-0.1.0.dist-info/entry_points.txt
(no such file / empty)
--- installed from ---
speaches-0.1.0.dist-info/RECORD -> _editable_impl_speaches.pth
--- source tree ---
/home/ubuntu/speaches/src/speaches: api_types.py audio.py config.py executors hf_utils.py main.py model_manager.py model_registry.py routers types ui utils.py
(no cli.py, no _entrypoints)
```

`uv run speaches` fails identically (`error: Failed to spawn: speaches`, os error 2). The pinned image
ships an *editable* install of the source tree with no console-script entry point, so the compose
command `uv run speaches-cli model download ...` cannot work on this tag. This is independent of the
Docker networking mode.

Consequence: the compose `depends_on: service_completed_successfully` gate on `agent` blocks the whole
stack. Nothing after it can come up through `docker compose up`.

Out-of-band workaround used for checks 4–5 (not a pass for the compose job):

```
$ docker compose --env-file env.example.template up -d 2>&1 | tail -3
 Container open-voice-speaches-models-1 Error service "speaches-models" didn't complete successfully: exit 2
service "speaches-models" didn't complete successfully: exit 2
```

`docker compose start agent` refuses for the same reason. The two long-lived containers were started
with plain `docker start open-voice-agent-1` and `docker start open-voice-web-1`, which bypasses the
compose dependency gate. The models were then populated with the image's own HTTP API
(`POST /v1/models/{id}`, present at `routers/models.py:82`).

### Defect 2 — `extra_hosts: host.docker.internal:host-gateway` does not work on this host

The agent cannot reach OmniRoute with the URL the stack configures. OmniRoute binds `0.0.0.0:20128`
(not loopback-only, as the plan assumed), so the failure is on the Docker side, not the daemon side.

```
$ ss -ltnp | grep 20128
LISTEN 0      4096       0.0.0.0:20128      0.0.0.0:*    users:(("omniroute (v16.",pid=205641,fd=21))

$ ip -brief addr
docker0          DOWN       172.17.0.1/16
<wifi-iface>           UP         <host-lan-ip>/24

$ ps -eo cmd | grep rootlesskit
rootlesskit --state-dir=/run/user/1000/dockerd-rootless --net=slirp4netns ... --disable-host-loopback ...

$ docker info | grep -E 'rootless'
 rootless
```

From inside the agent container:

```
$ docker compose --env-file env.example.template exec -T agent node -e '...fetch("http://host.docker.internal:20128/v1/chat/completions",{stream})'
        at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) {
          errno: -111,
          code: 'ECONNREFUSED',
          syscall: 'connect',
          address: '172.17.0.1',
          port: 20128
        }

$ docker exec open-voice-agent-1 cat /etc/hosts
172.17.0.1	host.docker.internal
$ docker exec open-voice-agent-1 node -e 'require("dns").lookup("host.docker.internal",(e,a)=>console.log(e?e.code:a))'
dns: 172.17.0.1

# from the agent container, both bases:
http://speaches:8000/v1/models             -> HTTP 200
http://host.docker.internal:20128/v1/models -> ERR ECONNREFUSED
```

The same daemon is reachable from the container through the host LAN address, so the LLM path itself is
sound — only the alias is broken:

```
$ docker exec open-voice-agent-1 node -e '...fetch("http://<host-lan-ip>:20128/v1/chat/completions",{stream})...'
HTTP 200 text/event-stream
content_chunks=9 done_marker=true
content="The container probe monitors the contents for safety."
```

Root cause: Docker is **rootless** here (`rootlesskit --net=slirp4netns --disable-host-loopback`).
The `host-gateway` special value resolves to `172.17.0.1`, which in rootless mode lives inside the
slirp4netns namespace, where the host's loopback is disabled, so connections are refused. Note the
plan's constraint "OmniRoute binds 127.0.0.1 only" is no longer true: it binds `0.0.0.0`, so the
daemon does not need the alias at all — a routable host address would do.

Impact: with the tracked configuration the agent starts and reports healthy but has **no LLM**. This is
the highest-severity finding because it is silent: `/healthz` returns ok and the startup log shows the
container-side URL, as check 5 requires.

### Not defects

- `TTS_VOICE=ef_dora` is valid. It is present in the live model list and in the image's voice table
  (`executors/kokoro/utils.py:94`, `language="es"`), and TTS synthesis succeeded. No voice fix needed.
- The pre-download job's *two-invocation shape* is fine; only the CLI invocation is unusable.

## Leftover state on the machine

- **Stopped**: `open-voice-agent-1` (exit 0), `open-voice-speaches-1` (exit 137, SIGKILL after the
  10s stop grace period), `open-voice-web-1` (exit 0), `open-voice-speaches-models-1` (exit 2).
  Nothing left running.
- **Left in place**: `open-voice_speaches-cache` volume, 802 MiB, holding both speech models, so the
  next run does not re-download. Images retained: `speaches:0.8.3-cpu` 3.03 GB,
  `open-voice-web:latest` 266 MB, `open-voice-agent:latest` 238 MB.
- **No `.env*` file was created** anywhere. Every compose command used
  `--env-file env.example.template`, with the token passed as
  `export LLM_API_KEY="$OMNIROUTE_API_KEY"` (35 characters, never printed).
- **Repository**: only untracked addition is this evidence file; `git status --porcelain` reports
  `?? odd/tasks/t4-verification-evidence.md`. Nothing committed, no product file changed.
