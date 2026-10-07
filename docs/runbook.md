# Open Voice runbook

Everything you need to configure, start, check and debug the stack. For how it is put together, see
[`architecture.md`](./architecture.md).

## 1. Prerequisites

| Requirement | Why | How to check |
| --- | --- | --- |
| Docker with Compose v2 | Runs `agent`, `web`, `speaches` | `docker --version && docker compose version` |
| OmniRoute running on this machine | It *is* the LLM; nothing in this stack provides one | `curl -s http://127.0.0.1:20128/v1/models` |
| `OMNIROUTE_API_KEY` in your shell environment | The bearer token OmniRoute expects | `test -n "$OMNIROUTE_API_KEY" && echo set` |
| An OmniRoute model combo | `auto/best-chat` must resolve to some upstream provider | `curl -s http://127.0.0.1:20128/v1/models` lists it |
| A Chromium-family browser with a microphone | Live mode uses `getUserMedia` and an AudioWorklet | — |
| About 4 GB of free RAM | Speaches loads faster-whisper and Kokoro on CPU | `free -h` |
| Network access to `ghcr.io` and the Hugging Face CDN, once | Images and the ~1.5 GB of speech model weights | — |

pnpm and Node are **not** required for the Docker path. You only need them for `pnpm dev` (see §7).

Ports **8787** (agent) and **3000** (web) must be free on the host.

## 2. Configure `.env`

```bash
cp env.example.template .env
```

If your tooling refuses to create a `.env` file — some editor and agent tooling classifies the `.env*`
path pattern as sensitive — pass the tracked template directly instead. The agent service takes its
configuration through Compose interpolation, which reads the project `.env` automatically but accepts
an explicit file too:

```bash
export LLM_API_KEY="$OMNIROUTE_API_KEY"
docker compose --env-file env.example.template up -d
```

Both paths produce the same container environment. The second keeps the token in the shell instead of
in a file.

Then put your real token in it. Do not put it anywhere else — `.env` is git-ignored and this repository never
stores a credential:

```bash
# LLM_API_KEY=replace-with-your-omniroute-token   <-- edit this line
LLM_API_KEY="$OMNIROUTE_API_KEY"
```

Use your editor, or:

```bash
sed -i "s|^LLM_API_KEY=.*|LLM_API_KEY=$OMNIROUTE_API_KEY|" .env
```

Confirm it landed without printing the secret:

```bash
grep -c '^LLM_API_KEY=.\+' .env    # expect 1
```

Two values must match this machine, and the example already sets them correctly:

- `LLM_BASE_URL` — the container must reach OmniRoute by a **routable host address**, not by
  `host.docker.internal`. This machine runs **rootless** Docker
  (`rootlesskit --net=slirp4netns --disable-host-loopback`), where that alias resolves to `172.17.0.1`
  and connections there are refused. From the host the same daemon is `http://127.0.0.1:20128/v1`.
  Refresh the address when your IP changes:
  ```bash
  ip route get 1.1.1.1 | awk '{print $7; exit}'
  ```
- `STT_REALTIME_ENABLED=false` — realtime STT is OpenAI-only and cannot be pointed at Speaches.

`STT_API_KEY` and `TTS_API_KEY` stay unset. Speaches needs no credential and the agent omits the
`Authorization` header for any explicit non-OpenAI base URL.

## 3. Start the stack

```bash
docker compose up -d --build
```

The first start pulls images and downloads model weights, so it takes several minutes. Later starts reuse the
`open-voice_speaches-cache` volume and are quick.

Watch it come up:

```bash
docker compose ps
docker compose logs -f speaches-models
```

`speaches-models` is a one-shot job: it downloads `Systran/faster-whisper-small` and then
`speaches-ai/Kokoro-82M-v1.0-ONNX`, and exits 0. The agent waits for it, so it never serves a
turn against a model that is still downloading.

## 4. Stop the stack

```bash
docker compose stop          # stop, keep containers and the model cache
docker compose down          # remove containers and the network, keep the model cache
docker compose down -v       # also delete the model cache; the next start re-downloads ~1.5 GB
```

The cache lives in the named volume `open-voice_speaches-cache`. Do not pass `-v` unless you mean to pay the
download again.

## 5. Health checks, in order

Run these from the host, top to bottom. Each one isolates a different failure.

```bash
# 1. All four services. expect: agent + web Up (healthy), speaches Up (healthy),
#    speaches-models Exited (0). If speaches-models says Exited (1), the download failed — see §8.
docker compose ps

# 2. The agent process is alive and reports its configuration. expect: status "ok",
#    plus llm/stt/tts flags. An "unhealthy" agent never logs a reason; use step 3.
curl -s http://127.0.0.1:8787/healthz

# 3. The agent's own startup line. expect: event agent.started with llmBaseUrl
#    equal to your LLM_BASE_URL, and NO event agent.llm_unreachable. The first is
#    where a config error shows up; the second is how a wrong host address
#    announces itself instead of failing silently later.
docker compose logs agent | grep agent.started

# 4. The web app is being served. expect HTTP 200.
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/

# 5. Speaches is up and has models loaded. expect: an object containing
#    "Systran/faster-whisper-small". This container has curl.
docker compose exec speaches \
  curl -s http://127.0.0.1:8000/v1/models

# 6. Nothing is crashing in a loop. expect: no repeating error lines.
docker compose logs --tail=50 agent web speaches
```

If step 3 prints nothing, the agent is not starting at all — go to §8.

## 6. Provider smoke tests

These prove each provider independently of the browser. Run them after §5.

### 6a. OmniRoute is the LLM

From the host, using the loopback URL and your token:

```bash
curl -s http://127.0.0.1:20128/v1/chat/completions \
  -H "Authorization: Bearer $OMNIROUTE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto/best-chat","stream":true,"messages":[{"role":"user","content":"Reply with one short word."}]}'
```

Expect SSE lines ending in `[DONE]`, and a `data:` chunk containing `"content"`. If you get
`No credentials for provider: ...`, OmniRoute has no credential for whichever upstream it picked for
`auto/best-chat` — fix OmniRoute, not this stack.

From inside the agent container, to prove the container-side URL works:

```bash
docker compose exec agent node -e "
fetch(process.env.LLM_BASE_URL + '/models', {
  headers: { Authorization: 'Bearer ' + process.env.LLM_API_KEY }
}).then(r => { console.log(r.status); process.exit(r.ok ? 0 : 1) })
 .catch(e => { console.error(e.message); process.exit(1) })"
```

Expect `200`. This is the check that catches a host address the container cannot actually open. If it
reports `ECONNREFUSED` or `ENETUNREACH` while the host-side curl in the previous command works, the
address in `LLM_BASE_URL` is the problem, not OmniRoute.

### 6b. Speaches serves speech synthesis (Kokoro)

```bash
docker compose exec speaches sh -lc '
  curl -s -X POST http://127.0.0.1:8000/v1/audio/speech \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"speaches-ai/Kokoro-82M-v1.0-ONNX\",\"voice\":\"ef_dora\",\"input\":\"Open Voice is ready.\"}" \
    -o /tmp/tts.mp3 && ls -l /tmp/tts.mp3'
```

Expect a file of a few kilobytes. `ls` reporting 0 bytes, or curl reporting `400`, means the voice or model id
does not exist in this Speaches build — see §8.

### 6c. Speaches serves transcription (faster-whisper)

The agent sends raw PCM16, which the gateway wraps in a WAV header before calling Speaches. Reproduce that
with a synthetic tone: it proves the endpoint and the model id, not recognition accuracy.

```bash
docker compose exec speaches python - <<'PY'
import math, struct, wave, io, json, urllib.request

# 1 s of 440 Hz at 16 kHz mono, 16-bit
rate, seconds = 16000, 1.0
pcm = b"".join(
    struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * n / rate)))
    for n in range(int(rate * seconds))
)
buf = io.BytesIO()
with wave.open(buf, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
    w.writeframes(pcm)
wav = buf.getvalue()

boundary = "----openvoice"
body = (
    f"--{boundary}\r\n"
    'Content-Disposition: form-data; name="file"; filename="tone.wav"\r\n'
    "Content-Type: audio/wav\r\n\r\n"
).encode() + wav + (
    f"\r\n--{boundary}\r\n"
    'Content-Disposition: form-data; name="model"\r\n\r\n'
    "Systran/faster-whisper-small\r\n"
    f"--{boundary}--\r\n"
).encode()

req = urllib.request.Request(
    "http://127.0.0.1:8000/v1/audio/transcriptions",
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
)
with urllib.request.urlopen(req, timeout=120) as response:
    print(response.status, response.read().decode())
PY
```

Expect `200 {"text":"..."}` — some transcription of the tone, quite possibly empty or nonsensical. A non-200
status with a model-not-found message means the STT model id is wrong or the volume is empty; see §8.

### 6d. End to end, without a microphone

Open `http://localhost:3000`, choose **Push to talk**, hold the button and say a short sentence. You should see
the transcript appear, the reply stream in, and hear the audio. Then say something while the reply is still
playing — playback must stop mid-sentence.

If Push to talk works and Live mode does not, the problem is VAD tuning, not the providers: adjust the
`NEXT_PUBLIC_VAD_*` values in `.env`, then rebuild the web image (§8, "VAD").

## 7. Running the agent on the host instead

Useful when you are changing agent code; not part of the Docker path.

```bash
pnpm install
pnpm build
pnpm --filter @open-voice/agent start
```

On the host use the loopback LLM URL — there is no container network, so Speaches must be reachable some
other way:

```dotenv
LLM_BASE_URL=http://127.0.0.1:20128/v1
STT_BASE_URL=http://127.0.0.1:8000/v1
TTS_BASE_URL=http://127.0.0.1:8000/v1
```

For the last two, publish Speaches' port with `docker compose port speaches 8000` and use whatever host port it
reports, or add `ports: ["8000:8000"]` to the `speaches` service while you are testing.

Two other ways to point the process at a different `.env`: `OPEN_GPT_LIVE_ENV_FILE=/path/to/file.env`, or the
`INIT_CWD` mechanism in the vendored `loadProjectEnvironment`.

## 7b. Agentic tools and the host executor

The agent can act on this machine through tools. This is **opt-in and gated**:
tools are off by default, and every action that leaves the sandbox needs your
approval in the browser UI.

### Enabling tools

In `.env`:

```dotenv
TOOLS_ENABLED=true
SANDBOX_TOKEN=<a-long-random-value>
```

`SANDBOX_TOKEN` must match `SANDBOX_TOKEN` in the sandbox service block — the
agent and sandbox share one credential. With both set, the agent opens a
WebSocket on port 8788 for tool activity. Open `http://localhost:3000` and you
will see a small tool-activity panel below the transcript.

### Enabling host escalation (optional)

The sandbox is a container; it cannot touch your machine. If a task genuinely
needs to run on the host, you can start the host executor yourself:

```bash
HOST_EXECUTOR_TOKEN=<same-as-agent> \
HOST_EXECUTOR_ALLOWED_COMMANDS="git status,git log *,ls -la *" \
HOST_EXECUTOR_DRY_RUN=true \
pnpm --filter @open-voice/host-executor start
```

Then tell the agent about it in `.env`:

```dotenv
HOST_EXECUTOR_BASE_URL=http://127.0.0.1:8791
HOST_EXECUTOR_TOKEN=<the-same-token>
```

The agent only needs `HOST_EXECUTOR_BASE_URL` and `HOST_EXECUTOR_TOKEN` to offer
the host tools (`host_exec`, `host_file_read`, `host_file_write`,
`host_browse`, `host_search`). Without both, it never tells the model the option
exists.

### Dry-run mode (the default)

With `HOST_EXECUTOR_DRY_RUN=true` (the default), host commands run inside the
host-executor's own container — not on your machine. Use this to test the
allowlist, the approval flow, and the audit log before you grant real access.

> **Note:** dry-run only confines the *command* execution. The `host_browse`
> and `host_search` tools still make real outbound network requests (to
> allowlisted domains) even in dry-run mode. Their egress is bounded by
> `HOST_EXECUTOR_EGRESS_ALLOWLIST`.

To escalate to the real host, stop the executor, set
`HOST_EXECUTOR_DRY_RUN=false`, and start it again. In that mode the executor
still needs `HOST_EXECUTOR_TOKEN` to authenticate the agent, and
`HOST_EXECUTOR_ALLOWED_COMMANDS` to permit specific commands.

### The approval gate

Every host tool call — and every sandbox tool call when `TOOLS_APPROVAL=all` —
pauses and shows a gate panel in the browser. Click **Approve** to run it, or
**Deny** to refuse. If nobody answers within 60 seconds, the answer is **deny**.
Closing the page denies everything pending.

### Auditing what the agent did

Every tool call is logged as a structured JSON line:

```bash
docker compose logs agent | grep tool.audit
```

Each line records the tool name, the action, the arguments the model asked for,
the outcome (`ok`, `error`, `timeout`, `cancelled`, `refused`, `denied`), the
exit code, and the duration. Host actions also carry `"dryRun": true` when
dry-run mode was on.

### Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Agent log shows `No host executor is configured on this machine` | `HOST_EXECUTOR_BASE_URL` or `HOST_EXECUTOR_TOKEN` is unset | Set both in `.env`, or start the host executor with `pnpm --filter @open-voice/host-executor start` |
| `host_exec` is refused with `not_allowed` | The command does not match `HOST_EXECUTOR_ALLOWED_COMMANDS` | Add the command to the allowlist, e.g. `git status` |
| `host_exec` is refused with `compound_command` | The command contains pipes, chains, redirects, or substitutions | Split it into separate `host_exec` calls; each must be a single simple command |
| `host_browse` is refused with `SSRF protection` | The URL resolves to a private or loopback address | Use a public https domain; the check is on the resolved IP, not the hostname |
| `host_search` is refused with "egress allowlist" | `HOST_EXECUTOR_EGRESS_ALLOWLIST` is empty or does not include a DuckDuckGo domain | Add `*.duckduckgo.com` to enable search |
| The tool-activity panel never appears | Tools are not enabled | Set `TOOLS_ENABLED=true` and `SANDBOX_TOKEN` in `.env` |

## 8. Common failures

| Symptom | Actual cause | Fix |
| --- | --- | --- |
| `LLM_API_KEY is required for api.openai.com` on a private-provider stack | `LLM_BASE_URL` resolved empty, so the agent fell back to the `https://api.openai.com/v1` default | Pass `LLM_BASE_URL` explicitly, or use `--env-file env.example.template` |
| Agent container exits immediately, no logs, `agent.start_failed` | A configuration error at startup: bad `GATEWAY_PORT`, malformed entry in `ALLOWED_ORIGINS`, unknown `LOG_LEVEL`, hosted `api.openai.com` URL without a key | Read the JSON error line; it names the variable. Fix it in `.env` |
| `LLM_API_KEY is required for api.openai.com` | `LLM_BASE_URL` is unset, empty, or a typo that left the `https://api.openai.com/v1` default in place | Set it explicitly to the container-side URL |
| `STT_API_KEY is required for api.openai.com, or point STT_BASE_URL at a self-hosted provider` | `STT_BASE_URL` unset, so it inherited the LLM base URL and failed the hosted-URL check | Set `STT_BASE_URL=http://speaches:8000/v1` explicitly |
| Web page loads, status stays "connecting" or "reconnecting" | The browser cannot reach the agent | `NEXT_PUBLIC_GATEWAY_WS_URL` must be a URL the *browser* can use, i.e. `ws://localhost:8787`. If you changed it, you changed it at build time: rebuild with `docker compose up -d --build web` |
| Browser console: 403 on the WebSocket handshake | `ALLOWED_ORIGINS` is set and does not contain the page origin | Use exact `http(s)://host:port` origins, no trailing slash, or clear the variable |
| Transcript never appears, agent log shows `ECONNREFUSED` on port 20128 or `speaches:8000` | Container cannot reach the host daemon or the Speaches service | For OmniRoute, `LLM_BASE_URL` must be a routable host address, not `host.docker.internal`: rootless Docker refuses host-bound services on that alias. Run the §6a container check. For Speaches, check `docker compose ps speaches` is `healthy` |
| `agent.llm_unreachable` in the agent log, but `/healthz` says ok | The agent started and is listening, but cannot open the LLM URL | `/healthz` proves the process is alive, not that its providers work. Fix `LLM_BASE_URL`, then restart the agent |
| `speaches-models` is `Exited (2)` with `Failed to spawn: speaches-cli` | The pinned Speaches image ships an editable install with no CLI entry point | Already handled: the job uses Speaches' HTTP API instead. If you see this, you are running an older compose file |
| Reply streams as text but no audio plays, agent log shows an error from `/v1/audio/speech` | Voice or model id is wrong for Kokoro | Check `curl http://127.0.0.1:8000/v1/models` for the exact ids, and set `TTS_MODEL` / `TTS_VOICE` from it. `TTS_VOICE` must be set: the upstream fallback is the OpenAI voice `alloy`, which does not exist in Kokoro |
| `speaches-models` is `Exited (1)` | The model download failed: no network, or a proxy/TLS interception on the Hugging Face CDN | `docker compose logs speaches-models` for the real error. Fix connectivity, then `docker compose up speaches-models` |
| First turn takes tens of seconds, later turns are fast | Weights were already in the volume but the CPU model is still warming up | Expected. Both models are pre-downloaded, but the first inference still pays model load. Later turns are warm |
| VAD cuts out mid-word, or triggers on silence | Thresholds too aggressive for the room | Raise `NEXT_PUBLIC_VAD_SPEECH_THRESHOLD`; lengthen `NEXT_PUBLIC_VAD_HANGOVER_MS` and `NEXT_PUBLIC_VAD_MIN_SPEECH_MS`; then `docker compose up -d --build web` |
| VAD never triggers on real speech | Threshold too high, or microphone permission denied | Lower `NEXT_PUBLIC_VAD_SPEECH_THRESHOLD`; confirm the browser's microphone permission, and note that the live panel shows the measured noise floor and threshold |
| The agent interrupts itself while talking | The microphone hears the speakers | Expected without echo cancellation. Use headphones |
| Conversation is empty after reloading the page | History lives only in the WebSocket connection | Expected. Not a bug; see architecture, known limitations |
| Editing a `NEXT_PUBLIC_*` value changes nothing | `NEXT_PUBLIC_*` is inlined at build time | `docker compose up -d --build web` |
| Editing an `LLM_*`/`TTS_*` value changes nothing | Those are read at container start | `docker compose up -d agent` |
| Port 8787 already in use, `EADDRINUSE` | Something else owns the port, often a leftover agent process | `ss -ltnp 'sport = :8787'`, then stop it. Never run `apps/gateway`'s `dist/server.cjs` alongside the agent |

## 10. Latency

Every stage of a turn was measured on this machine. A turn is serial: speech end, STT, LLM first
token, TTS first sentence, playback.

| Stage | Before | Now | How |
| --- | ---: | ---: | --- |
| VAD hangover before a turn closes | 750 ms | 750 ms | **deliberately not lowered, see below** |
| Batch STT, 2.4 s of real speech | 9.4 s | **2.9 s** | `STT_MODEL` moved from `faster-whisper-small` to `faster-whisper-base` |
| LLM first token, typical | 1.3 s | **0.6 – 0.9 s** | `LLM_MODEL` moved from `auto/best-chat` to `auto/chat` |
| TTS first sound after the first token | ~3.5 s | ~3.5 s | left at the gateway default of 24 |

Roughly 12–14 s per turn became roughly 5 s, measured through the agent's own WebSocket.

The agent's own variables, all defaulting to the gateway's own defaults unless set:
`TTS_SEGMENT_MIN_LENGTH`, `TTS_SEGMENT_MAX_LENGTH`, `LIVE_PARTIAL_INITIAL_INTERVAL_MS`,
`LIVE_PARTIAL_LONG_TURN_INTERVAL_MS`, `LIVE_PARTIAL_LONG_TURN_AFTER_MS`.

Trading further:

- `STT_MODEL=Systran/faster-whisper-tiny` is **1.6 s** and produced the same transcript on the
  reference clip, but is weaker on accents, room noise and uncommon words. Try it, and go back to
  `base` if it mishears you.
- `LLM_MODEL` left on an `auto/*` combo lets the router choose a provider per call, and that choice
  varies: the same request was measured from 536 ms to 7 s. Pinning an explicit provider removes the
  tail: `LLM_MODEL=groq/openai/gpt-oss-20b` measured 426 / 511 / 1935 ms across five calls.
  `curl -s http://127.0.0.1:20128/v1/models` lists what is available.
- `NEXT_PUBLIC_VAD_HANGOVER_MS` was tried at 400 ms to shave dead air and it made the agent
  understand *less*. The hangover is what lets the last word finish. Transcribing one clip with its
  tail trimmed: intact gives "una frase muy corta", 200 ms trimmed gives "muy corte", 400 ms gives
  "muy..." and 600 ms gives "o la presentate in una frase". The 350 ms is not worth the words.
- Do not look for a bigger STT model to buy accuracy. On this CPU model size is latency:
  tiny 1.3 s, base 2.5 s, small 7.6 s, medium 25 s, large-v3-turbo 32–37 s. `base` is the only
  point where the curve is not brutal. If words are still lost, `Systran/faster-whisper-small` is the
  one step up and it costs about five seconds per turn.
- A noisy room costs more accuracy than a small model does. The measured idle noise floor in this
  room sits above the speech threshold at times, which is what made the VAD misfire in the first
  place. Headphones and speaking closer to the mic beat any model swap.
- `TTS_SEGMENT_MIN_LENGTH`, `TTS_SEGMENT_MAX_LENGTH`, `LIVE_PARTIAL_INITIAL_INTERVAL_MS`,
  `LIVE_PARTIAL_LONG_TURN_INTERVAL_MS` and `LIVE_PARTIAL_LONG_TURN_AFTER_MS` are agent variables and
  all default to the gateway's own values. Lowering the segment minimum was tried and did nothing
  measurable: three runs each gave first sound at 3.3 / 5.5 / 3.6 s with 24 and 4.0 / 3.9 / 2.9 s with
  10. Do not tune it on the strength of one run.

### A trap worth knowing about

Compose only passes a variable into a container if the service block names it. Two variables were once
added to the template and to the agent's parser but never named in the `agent` service, so they
silently never reached the process and both fell back to defaults: English kept using the Spanish
voice, and a latency improvement was "measured" that was really just noise. An absent variable is
invisible by nature. `packages/agent/src/compose-wiring.test.ts` now fails the build if the agent
parses a variable compose does not pass, if compose passes one the template never documents, or if
the two drift apart on a default. When you add a variable, that test is what tells you it works.

What no configuration can fix: **STT still waits for you to stop talking.** Speaches does not
implement the OpenAI Realtime WebSocket protocol, so there is no token-by-token transcription and the
whole STT cost sits after the hangover. That is the single largest remaining structural cost.

### Networking

The agent runs with `network_mode: host`. On rootless Docker there is no usable container route to a
host service: `host.docker.internal` refuses connections, the slirp gateway is unreachable, and
routing through the host's WiFi address measured anywhere between 1.4 s and 18 s for the same
request. Loopback is both correct and the fastest option, and Speaches is published on
`127.0.0.1:8000` for it.

## 11. Speaking more than one language

Kokoro is a single multilingual model. It never needs to be swapped per
language; the *voice* is what is language specific. This image ships Spanish
`ef_dora`, `em_alex`, `em_santa`, and English `af_*` and `am_*` (American) and
`bf_*` and `bm_*` (British). Speaking English with `ef_dora` is what produces
the bad accent, not a broken model.

Setting `TTS_VOICE_EN` turns on language routing: the agent classifies each
synthesized segment and picks `TTS_VOICE_ES` or `TTS_VOICE_EN` for it, falling
back to `TTS_VOICE` when it cannot decide. That happens per segment, so a reply
that switches language mid-sentence switches voice too. Leave `TTS_VOICE_EN` unset
for a single fixed voice, which is the previous behavior.

To audition a voice before committing:

```bash
curl -s -X POST http://127.0.0.1:8000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"speaches-ai/Kokoro-82M-v1.0-ONNX","voice":"af_heart","input":"Hello, how can I help?"}' \
  -o /tmp/voice.mp3
```

## 9. Replacing the persona

Precedence in `packages/agent/src/prompt.ts` is **`AGENT_SYSTEM_PROMPT_FILE`**, then **`AGENT_SYSTEM_PROMPT`**,
then the built-in default. A configured file that is unreadable or blank is a startup error, not a silent fall
back to the default.

**Short persona, inline.** Put a single line in `.env`:

```dotenv
AGENT_SYSTEM_PROMPT=You are a radio host. Answer in at most two spoken sentences.
```

**Long persona, from a file.** Write the text outside the repository (or in a git-ignored path), then point at
it. The file is read at startup, so restart the agent after changing it:

```bash
docker compose stop agent
printf 'You are Open Voice.\nSpeak in short plain sentences.\nNever use markdown or lists.\n' > /tmp/persona.txt
docker compose run --rm --no-deps -v /tmp/persona.txt:/run/prompts/persona.txt:ro \
  -e AGENT_SYSTEM_PROMPT_FILE=/run/prompts/persona.txt agent
```

The `-v` bind mount is the simplest way to get a file into the container, and `ro` keeps it read-only. To make
it permanent, add the mount to the `agent` service and set `AGENT_SYSTEM_PROMPT_FILE` in `.env`.

Write for the ear, not the screen: no markdown, no lists, no emoji, no URLs, one idea per sentence. The
prompt's whole job is to keep the reply speakable, because the model cannot know its own text will be read by a
voice synthesizer.