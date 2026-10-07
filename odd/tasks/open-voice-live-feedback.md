# Feature: open-voice-live-feedback

## Goal

Make the interface honest and comfortable during real use. Three defects were found by using the
product, not by reading it: there is no working microphone switch, the plot forces the page past
the bottom of the screen, and the field goes dead whenever the agent is the one speaking.

## What use found

1. **There is no microphone mute.** `vadMuteGain` exists only to keep the capture graph from feeding
   the speakers, and it is pinned at zero. Nothing gates capture. The only way to stop the microphone
   is to turn Live mode off, which is not a mute.
2. **The page scrolls.** At a normal desktop window the plot is taller than the viewport, so the
   first view does not fit and the user must scroll to see the composer.
3. **The field is only alive for the human.** Playback runs through an `HTMLAudioElement`, outside
   the Web Audio graph, so there is no amplitude to sample while the agent speaks. The plot rests at
   the baseline for the entire half of the conversation the agent owns.

## Decisions

- The microphone control is an explicit ON/OFF switch in the composer, beside the two activation
  controls, and it genuinely stops capture rather than only hiding output.
- The plot carries the world palette: the trace takes the colour of the state it is showing, so the
  field is readable without reading a label.
- Playback is routed through the Web Audio graph so the agent's own voice is measured, not guessed.

### What an in-flight turn does when the switch goes off — the choice

**A turn already in flight is allowed to finish. It is not cut.**

Muting the microphone is a decision about the *next* thing the user says, not a retroactive deletion
of something already said. Cutting mid-utterance would discard a real observation the user actually
made, and in live mode it would strand a turn that has already sent `vad.speech_start`: the gateway
would be left waiting for a `vad.speech_end` that nothing would ever send.

So turning the switch off closes the gate immediately — no further frames are captured and none are
sent — and then closes whatever turn is open with exactly the audio captured up to that moment:

- **Push-to-talk:** the recorder stops, so the turn finalizes and sends the audio it already holds.
- **Live mode, turn open:** it is closed with a normal `vad.speech_end` carrying reason `manual`, an
  existing protocol value. The frames already sent complete a real utterance rather than a hung one.
- **Live mode, no turn open:** the pre-roll buffer is discarded and the detector's candidate is
  cancelled, so nothing recorded while muted can be prepended to a future turn.

Playback and text are untouched. The switch governs the microphone, not the agent: the agent keeps
talking and the plot keeps showing the agent's voice. The switch is its own piece of state, so
turning Live mode on and off never silently reopens the microphone.

### The switch's colour

The switch is **Signal Blue** (`--color-transcribing`) when on and the secondary panel fill when off.
Blue is already the world's code for "the microphone is capturing", so the state is legible from
colour alone. It is never red: red is reserved for a cut.

## Non-goals

- No new states. The plot shows the same five the backend can produce.
- No change to the interruption model, the turn index, or the strike.
- No change to the agent, the gateway, or the protocol.
- No new colours. Every token the fix uses already exists.

## Tasks

### M1 — A microphone switch that actually switches

An explicit ON/OFF control in the composer. Off means no audio is captured and no frames are sent,
and the state is visible in the colour code. It must be distinguishable from Live mode being off:
turning the microphone off is a user decision that persists across turning Live on and off.

Decide and document what happens to an in-flight turn when it goes off.

### M2 — Fit the first viewport

At 1440×900 and at a laptop height the first view must fit without vertical scrolling, with the
composer visible without scrolling. The plot is the flexible element; the readout and the composer
are not.

Two causes, both real:

1. **The root `rem` base was wrong.** The base rule declared `font-size: var(--size-body)` on `html`
   as well as `body`. Because `--size-body` is itself a rem value, that redefined the `rem` base: the
   root became 18px, and every rem on the page then resolved against 18px instead of 16px. Body
   computed to 20.25px and the 6rem display rendered at 108px instead of the documented 96px — the
   whole type scale and spacing set was inflated by 12.5%. The size now lives on `body` only, which
   restores the exact px values DESIGN.md documents.
2. **The shell was unbounded.** `min-height: 100vh` let the work area grow past the viewport, and the
   canvas took its size from that grown container, so the plot set the page's height. The shell is
   now exactly the viewport tall (`100dvh`, with a `100vh` fallback) and `min-height: 0` runs down
   the flex chain so the plot absorbs the leftover space instead of pushing the page.

The plot takes its size from the viewport rather than from a pixel floor. Below 1024px the existing
stacking queries take over: the shell is allowed to grow and scroll again, because a phone is a page,
not a single screen.

### M3 — A field that is alive for both voices

- Route playback through the existing Web Audio graph instead of `HTMLAudioElement`, and sample the
  agent's amplitude the same way the microphone's is sampled. Playback behaviour, ordering, latency
  marks and the existing unit tests must not regress.
- Colour the trace by state, using the world's existing tokens. Red stays reserved for a cut.
- Under `prefers-reduced-motion`, the plot stays still in every state.

Notes on how this was built:

- The graph is kept alive for the session. Tapping the reply with an `AnalyserNode` and connecting it
  through to the destination is what makes the agent's own voice measurable; the plot then reads
  time-domain data, reduces it to RMS and square-roots it with the same formula it already used for
  the microphone, so both voices are treated identically.
- Ordering is unchanged: one segment sounds at a time, and the queue stays `playing` across the
  decode so a chunk arriving mid-decode cannot start a second one. `firstAudioPlaybackAt` is marked
  when the segment starts sounding.
- A cut still stops the segment mid-sentence, and a browser that refuses to start audio without a
  gesture still surfaces the same manual-play affordance — now holding the decoded buffer instead of
  an `HTMLAudioElement`.
- The trace takes the phase's own colour; the grid keeps plot ink. Red is never among the trace
  colours, because a cut is permanent and lives in the index as a strike.

## Verification

Each task closes on `pnpm --filter @open-gpt-live/web typecheck`, `pnpm test` (the suite must stay
at 17 files and 135 tests), the web image rebuilding, and a recapture at 1440×900 and at a laptop
height showing no vertical scroll.

## Commit plan

| Task | Commit |
| --- | --- |
| M1 | `feat(web): add a microphone switch that really gates capture` |
| M2 | `fix(web): fit the first viewport without vertical scroll` |
| M3 | `feat(web): measure the agent's own voice and colour the trace by state` |