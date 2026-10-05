# T5 Acceptance Evidence — browser, real microphone

Date: 2026-10-05. Branch `feat/open-voice-vertical-minimo`. Stack running during the check: `agent`
:8787, `web` :3000, `speaches` with both models cached.

Verdict up front: **partially accepted.** The text path, streaming, synthesis and the abort path are
proven. A complete live spoken turn is **not** proven, and the cause is measured and reproducible:
in a silent room this microphone reads far above the speech threshold, so the VAD treats room noise
as continuous speech and every live turn is cancelled by the next one.

---

## 1. Fake-microphone route: blocked by the browser, not by the project

`--use-file-for-fake-audio-capture=<wav>%noloop` was tested against three binaries: Playwright's
Chromium 1243 (with and without `%noloop`) and `/usr/bin/chromium`. None of them delivered the file.
All three played Chromium's default fake beep, measured in-page with an `AnalyserNode`:

```
playwright-chromium:      first12=[0,0.0144,0.0077,0.0068,0.0179,0.0319,0.0247,0.0258,...] quiet_in_first5s=3/12
playwright-chromium-noLoop: first12=[0,0.0161,0.0093,0.0077,0.0054,0.0042,0.0036,...] quiet_in_first5s=5/12
system-chromium:          first12=[0,0.0182,0.0371,0.0384,0.0057,0.0048,0.0097,0.178,...] quiet_in_first5s=2/12
```

The WAV contained 6 s of digital silence before the speech; no binary reproduced it. The file was a
real Spanish sentence produced by this project's own Kokoro TTS, converted to 16 kHz mono PCM16.
This route is abandoned; it does not indicate a defect in the agent.

## 2. Real microphone: capture and transcription work

Chromium with the real built-in microphone, Live mode activated by clicking the real control, and the
question played out loud through the speakers at sink volume 0.15.

Speech reached the model. The UI rendered a user message:

```
USER_TRANSCRIPT="hubo unos intentos"
```

The agent log confirms the audio actually crossed the whole STT path, batch adapter, not a stub:

```
{"event":"latency.stt","requestKind":"live","sttPath":"batch","outcome":"interrupted","sttFirstPartialMs":19859}
```

The transcript is garbled because a laptop microphone listening to a speaker at low volume is a poor
audio path. That is expected and is not the blocker.

## 3. Blocker: the VAD never sees silence in this room

Every live turn ended the same way, across three separate runs:

```
{"event":"latency.stt","requestKind":"live","sttPath":"batch","outcome":"interrupted"}
{"event":"audio.cancelled","reason":"live mode barge-in"}
```

Repeated every few seconds. The barge-in mechanism is working; it is being triggered by noise.

The VAD panel, read from the running page while **nothing was playing and nobody was speaking**:

```
t+2s  adaptive state=speaking RMS 0.1051  noise floor 0.0349  speech/silence 0.1046 / 0.0627
t+4s  adaptive state=idle     RMS 0.0110  noise floor 0.0349  speech/silence 0.1046 / 0.0627
t+6s  adaptive state=speaking RMS 0.0403  noise floor 0.0090  speech/silence 0.0271 / 0.0163
t+8s  adaptive state=pause    RMS 0.0057  noise floor 0.0090  speech/silence 0.0271 / 0.0163
t+10s adaptive state=speaking RMS 0.0446  noise floor 0.0100  speech/silence 0.0300 / 0.0180
t+12s adaptive state=pause    RMS 0.0059  noise floor 0.0100  speech/silence 0.0300 / 0.0180
t+14s adaptive state=speaking RMS 0.2507  noise floor 0.0100  speech/silence 0.0300 / 0.0180
t+16s adaptive state=speaking RMS 0.0973  noise floor 0.0100  speech/silence 0.0300 / 0.0180
t+18s adaptive state=speaking RMS 0.0803  noise floor 0.0100  speech/silence 0.0300 / 0.0180
t+20s adaptive state=speaking RMS 0.0404  noise floor 0.0100  speech/silence 0.0300 / 0.0180
```

The calibration measures a floor of 0.009–0.010, but idle RMS reaches 0.040–0.250, against a speech
threshold of 0.030. Idle audio sits four to twenty-five times above the speech threshold, so the
detector is in `speaking` state most of the time and never reaches the 750 ms hangover needed to close
a turn. A turn therefore starts, and the next spurious "speech" cancels it as barge-in.

This is a tuning problem in this room with this microphone, not a broken pipeline. The knobs are the
documented `NEXT_PUBLIC_VAD_*` build-time variables, principally
`NEXT_PUBLIC_VAD_SPEECH_NOISE_MULTIPLIER` and `NEXT_PUBLIC_VAD_DYNAMIC_SPEECH_MIN`.

## 4. Proven: streaming reply, synthesis, and interruption

Text turn, submitted through the real UI, then `Stop` clicked while the reply was streaming:

```
PHASE2 len_before_stop=57 len_after_stop=57 len_settled=57
PHASE2 settled_text="Puedo contar una breve historia sobre el mar. ¿Te parece?"
```

```
{"event":"latency.llm_first_delta","requestKind":"text","llmFirstDeltaMs":2368}
{"event":"request.finished","requestKind":"text","stage":"interrupted","requestTotalMs":2718}
```

The reply length froze at 57 characters across the abort plus three further seconds, so deltas and
audio arriving after the stop were discarded rather than appended, and the agent recorded the request
as interrupted. That is the abort path barge-in also uses.

TTS is proven separately from T4: `POST /v1/audio/speech` with voice `ef_dora` returned 14,904 bytes
of `audio/mp3`.

## 5. Not proven

- A complete live spoken turn: final transcript, streamed reply and spoken audio from one microphone
  utterance. Blocked by section 3.
- Acoustic barge-in during spoken playback. Blocked by section 3.
- Anything about human speech quality, latency feel, or wake behaviour.

## 6. Next step

Tune `NEXT_PUBLIC_VAD_SPEECH_NOISE_MULTIPLIER` and `NEXT_PUBLIC_VAD_DYNAMIC_SPEECH_MIN` upward for this
room, rebuild the web image, and repeat sections 2 and 3. The tuning is a judgement call about a real
room and a real pair of ears, so it is left to the human rather than guessed at.