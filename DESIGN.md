---
name: Open Voice — El Núcleo Vivo
description: "A speaking agent in a dark room: the conversation holds the center, and a spectral field that moves only on sound rides the right rail."
colors:
  ground: "#000000"
  background-panel: "hsl(0, 0%, 10%)"
  border: "hsl(0, 0%, 20%)"
  ink: "hsl(0, 0%, 80%)"
  text-primary: "hsl(0, 0%, 95%)"
  text-secondary: "hsl(0, 0%, 70%)"
  surface-hover: "hsl(0, 0%, 15%)"
  idle: "hsl(210, 10%, 40%)"
  transcribing: "hsl(210, 80%, 50%)"
  thinking: "hsl(50, 80%, 50%)"
  speaking: "hsl(40, 60%, 80%)"
  cut: "hsl(0, 80%, 50%)"
  cut-deep: "hsl(0, 80%, 40%)"
  signal-blue-lifted: "hsl(210, 80%, 62%)"
  cut-red-lifted: "hsl(0, 80%, 64%)"
  notice-surface: "hsl(210, 20%, 15%)"
  notice-ink: "hsl(210, 70%, 80%)"
  notice-border: "hsl(210, 50%, 30%)"
  error-surface: "hsl(0, 50%, 15%)"
  error-ink: "hsl(0, 70%, 70%)"
  error-border: "hsl(0, 50%, 30%)"
typography:
  display:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 2.25rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  readout:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 2.5rem
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  body:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 0.8125rem
    fontWeight: 500
    letterSpacing: "0.05em"
  caption:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 0.6875rem
    fontWeight: 400
  preview:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 0.8125rem
    fontWeight: 400
  composer-control:
    fontFamily: 'Azeret Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: 0.6875rem
    fontWeight: 500
    letterSpacing: "0.08em"
  mono-number:
    fontFamily: 'Azeret Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: 0.6875rem
    fontWeight: 400
    fontFeature: '"tnum"'
rounded:
  control: "0px"
  scrollbar-thumb: "4px"
spacing:
  xs: "0.125rem"
  sm: "0.25rem"
  md: "0.5rem"
  lg: "0.75rem"
  xl: "1rem"
  "2xl": "1.5rem"
components:
  button-submit:
    backgroundColor: "{colors.text-primary}"
    textColor: "{colors.ground}"
    typography: "{typography.composer-control}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
  button-submit-hover:
    backgroundColor: "{colors.background-panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.composer-control}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
  button-secondary:
    backgroundColor: "{colors.background-panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.composer-control}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text-primary}"
    typography: "{typography.composer-control}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
  button-live-on:
    backgroundColor: "{colors.cut}"
    textColor: "{colors.text-primary}"
    typography: "{typography.composer-control}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
  button-live-on-hover:
    backgroundColor: "{colors.cut-deep}"
    textColor: "{colors.text-primary}"
    typography: "{typography.composer-control}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
  button-recording:
    backgroundColor: "{colors.cut}"
    textColor: "{colors.text-primary}"
    typography: "{typography.composer-control}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
  button-mic-on:
    backgroundColor: "{colors.transcribing}"
    textColor: "{colors.ground}"
    typography: "{typography.composer-control}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.875rem"
  input-message:
    backgroundColor: "{colors.background-panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.75rem"
  status-connected:
    textColor: "{colors.transcribing}"
    typography: "{typography.label}"
  color-strip:
    backgroundColor: "{colors.idle}"
    height: "3px"
  panel-heading:
    backgroundColor: "{colors.background-panel}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    padding: "0.375rem 0.75rem"
  dialogue-entry:
    backgroundColor: "{colors.background-panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    padding: "0 0 0.625rem 0.5rem"
  log-line:
    backgroundColor: "{colors.background-panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.mono-number}"
    padding: "0.0625rem 0"
  log-tag:
    backgroundColor: "{colors.background-panel}"
    textColor: "{colors.transcribing}"
    typography: "{typography.mono-number}"
    padding: "0"
  entry-readout:
    textColor: "{colors.text-primary}"
    typography: "{typography.readout}"
  latency-panel:
    backgroundColor: "{colors.background-panel}"
    padding: "0.5rem"
  notice:
    backgroundColor: "{colors.notice-surface}"
    textColor: "{colors.notice-ink}"
    padding: "0.5rem 0.75rem"
  error:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error-ink}"
    padding: "0.5rem 0.75rem"
---

# Design System: Open Voice — El Núcleo Vivo

## Overview

**Creative North Star: "El Núcleo Vivo"**

The interface is a dark room with one living presence — a radial field — but the conversation is what the screen is for. The room is read in three columns: the catalog of turns on the left, the conversation in the middle, and the agent's presence and its measurements on the right. The middle column is the largest and holds the two things a conversation is made of: the dialogue, and beneath it the activity log of everything the pipeline did. Only then does the eye reach the rail, where the field sits above the current entry's readout and the instrumentation.

The field is quiet by default. It animates only while a real signal feeds it: seventy-two spectral bars ignite around a glowing core while the user talks or the agent answers, and the ring turns through the visible spectrum when the agent speaks. With nothing sounding — idle, and the whole thinking phase — the field is a still mark: two guide rings and a resting core, no sweep, no bars, no motion at all. A speaking agent is an event, not a constant animation.

The chrome is deliberately flat so nothing competes with the words. No corner is rounded, no surface casts a shadow, no panel is translucent. Depth is a two-step tonal floor between black and a very dark grey, and all glow lives in the canvas alone. The design is dense rather than explanatory: the user already knows the product, and the interface's job is to prove what just happened, measured.

The conversation itself is a catalog of numbered turns. Every entry carries a zero-padded FAC number in tabular monospace, an answer is the entry under the current number — never a chat bubble — and an interrupted turn is struck through in red for the life of the session. The dialogue and the activity log both follow their newest line, so the latest exchange is always the one on screen. Latency is a feature: per-turn timings and the live voice-activity readout sit permanently in the rail, because the measurements are the authority over intuition. The microphone is never ambient: it opens only when the user arms it, through the Mic switch, push-to-talk, or Live mode.

**Key Characteristics:**
- Three columns: the turn index, the conversation (dialogue over the activity log), and the JARVIS rail (field, readout, instrumentation)
- A radial field that rests without signal: 72 spectral bars, a breathing core and a radar sweep, drawn only while real FFT data — microphone or reply playback — feeds it
- The talking phases own their single hue; the speaking phase owns the full visible spectrum, the world's one deliberate multi-hue moment
- An activity log on the same phase code the field uses, with a line for every turn event and the model's own words
- Matte black ground, panel void, one-pixel hairlines; glow lives in the canvas alone
- Zero corner radius on every control, panel, strip and readout
- Engraved tracked capitals for system words; tabular monospace for every number
- Compact density: the whole working session fits one screen above 1024px

## Colors

A four-phase industrial colour code on a grayscale floor — one hue per product state — with the speaking field's drifting spectrum as the single deliberate exception.

### Primary
- **Signal Blue** (`hsl(210, 80%, 50%)`): the microphone's colour and the capturing phase. It fills the Mic switch when armed, the connected status pill, and the transcribing strip, and it is the text-selection background. It measures 5.24:1 on the black ground (AA) and 4.37:1 on the panel ground, so check the surface before using it as small text.

### Secondary
- **Amber Signal** (`hsl(50, 80%, 50%)`): the thinking phase — the model is streaming and no audio exists yet. It also draws the active catalog entry's left border and the keyboard focus outline.
- **Bone** (`hsl(40, 60%, 80%)`): the speaking phase — synthesized audio playing. The warmest and quietest code in the set; at 14.75:1 on black it is the most legible.

### Tertiary
- **Cut Red** (`hsl(0, 80%, 50%)`): reserved for an interruption and for the states where a stream is open — the Live-on and Recording fills, and the permanent strike through a cut entry. Nothing transient, decorative, or merely loud may be red.
- **Steel Grey** (`hsl(210, 10%, 40%)`): the idle phase — nothing is happening. Deliberately desaturated so idleness reads as absence of signal rather than as a state that needs attention.

### Neutral
- **Matte Black** (`#000000`): the ground of the shell and the field.
- **Panel Void** (`hsl(0, 0%, 10%)`): the single elevated surface — turn index, right rail, composer, input, and instrumentation all sit on it. Hover adds exactly one step (`hsl(0, 0%, 15%)`), a 1.15:1 lift visible as a change of surface, not a glow.
- **Hairline Divider** (`hsl(0, 0%, 20%)`): every border in the system, one pixel. At 1.66:1 against black it is a drawn line, not a contrast-bearing edge.
- **Plot Ink** (`hsl(0, 0%, 80%)`): the field's guide rings at 12% alpha. It doubles as the hover colour for catalog entries and composer buttons.
- **Plotter White** (`hsl(0, 0%, 95%)`): primary text, and the fill of the Send button.
- **Etched Gray** (`hsl(0, 0%, 70%)`): secondary text, placeholders, and inactive catalog entries.
- **Notice Blue-Grey** (surface `hsl(210, 20%, 15%)`, ink `hsl(210, 70%, 80%)`, hairline `hsl(210, 50%, 30%)`): transient status, duotone rather than chromatic.
- **Error Red-Grey** (surface `hsl(0, 50%, 15%)`, ink `hsl(0, 70%, 70%)`, hairline `hsl(0, 50%, 30%)`): failures — a muted duotone that never borrows the Cut Red token.

### Lifted Inks
Two steps of the phase colours exist for small text on the panel ground, where the base tokens fall under 4.5:1 at 11px:
- **Signal Blue, Lifted** (`hsl(210, 80%, 62%)`): the activity log's `STT` tag and the dialogue's mic mark. The base Signal Blue measures 4.37:1 on panel void, under AA for small text.
- **Cut Red, Lifted** (`hsl(0, 80%, 64%)`): the activity log's `CUT` tag. The base Cut Red measures 3.98:1 on panel void. It is still only ever a cut.

They are the same hues stepped up for legibility, never a new category: on the black ground the base tokens stay in use.

### Named Rules
**The Phase Code Rule.** Every product phase owns exactly one colour — idle steel, transcribing blue, thinking amber, speaking bone — and the colour strip in the right rail is the only place a phase appears as a large flat fill. A cut is never a phase on the strip: interruption lives as the permanent red strike in the turn index, where it stays for the life of the session. When the agent is **acting** — executing a tool inside the sandbox — it reuses amber, the thinking colour: the strip stays on one hue while the model is still working. The readout names the phase in words as "Acting" so the distinction is visible without a new colour token.

**The Spectrum Rule.** The speaking field is the world's one deliberate full-spectrum moment. While the agent speaks, each of the 72 bars takes a hue from a band drifting with the sweep — `hsl((index × 3.5 + sweepAngle × 24) mod 360, 72%, 50–62%)` — so a reply is visibly a wave of colour moving through the ring. Every other phase keeps its single hue, and no other element in the interface uses more than one.

**The Glow Belongs To The Field Rule.** All glow is canvas glow: spectral bars cast a `shadowBlur` of 5 + magnitude×9 in their own colour, and the core casts 18. The CSS chrome carries no `box-shadow`, no blur, and no translucency — depth there is the two-tone ground and one-pixel hairlines.

**The Field Rests Without Signal Rule.** The field moves only while a real signal feeds it — the microphone's spectrum or the reply's. With no signal — idle, and the whole thinking phase — it draws only the guide rings and a still resting core: no sweep turns and no bar is drawn, and the draw loop stops rather than animating a frame it has nothing to say with. A short decay lets the bars fall to the ring when a signal leaves, then the field comes to rest again.

## Typography

**Display Font:** Archivo (400 and 600, self-hosted woff2, SIL OFL 1.1) with `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
**Body Font:** Archivo (same stack — there is no separate body face)
**Label/Mono Font:** Azeret Mono (400 and 500, self-hosted woff2) with `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

**Character:** One grotesque carries every word, so the interface reads as a single printed voice. Azeret Mono is reserved strictly for anything a person might compare against something else — numerals, FAC numbers, control labels. The pair is deliberately non-decorative: no italic, no serif, no optical-sizing flourishes.

### Hierarchy
- **Display** (600, 2.25rem/36px, line-height 1.25, tracking -0.03em): the product name, once, in the header. The largest type on the page, never reused as a section heading.
- **Readout** (600, 2.5rem/40px, line-height 1, tracking -0.03em): the current entry's FAC number in the right rail. This is the world's real headline — the number is the subject of the screen.
- **Body** (400, 0.9375rem/15px, line-height 1.5): document default, the header subtitle, and the composer text input. The size lives on `body`, never on `html`, so the rem base stays at the browser's 16px and the pixel values hold.
- **Label** (500, 0.8125rem/13px, tracking 0.05em, uppercase): engraved system caps — the language mark, the `Turns` column heading, panel headings.
- **Caption** (400, 0.6875rem/11px): definition terms in the instrumentation panels and status text beside a heading. Not uppercase — it is read, not engraved.
- **Preview** (400, 0.8125rem/13px): the catalog entry's preview line in the index, truncated with an ellipsis.
- **Composer Control** (Azeret Mono 500, 0.6875rem/11px, tracking 0.08em, uppercase): every composer button label (`Send`, `Live experimental`, `Hold to Talk`, `Mic on`, `Stop`).
- **Mono Number** (Azeret Mono 400, 0.6875rem/11px, `font-variant-numeric: tabular-nums`): every measured latency value and the FAC number in the index. Tabular figures are what make a column of timings legible; proportional digits in a readout are a bug, not a style.

### Named Rules
**The Engraved Rule.** System text is uppercase with wide tracking (0.05em for Archivo labels, 0.08em for monospace control labels). Sentence case is reserved for content that came from speech or from the user.

**The Numbering Rule.** Every number is set in Azeret Mono with `font-variant-numeric: tabular-nums`, and FAC numbers are zero-padded to three digits (`007`, not `7`) so the column does not reflow as the catalog grows. Never style a numeral in the display face.

## Layout

The shell is a vertical flex column, exactly the viewport tall at desktop widths (`100dvh`, with a `100vh` fallback): header, meta line, work area, composer. The work area is a horizontal flex with `overflow: hidden`, in three columns. Above 1024px the whole working session fits one screen — the shell is height-locked and the page never scrolls; below it the shell grows to its natural height so nothing is clipped.

**The turn index** (left) is about 20% of the width, capped at 200px, and scrolls on its own.

**The conversation column** (center, `flex: 1`, `min-width: 0`, `min-height: 0`, on the panel ground) stacks two panels. The **dialogue** takes three parts of the column and the **activity log** two — a 60/40 split, each with its own heading and its own scroll, each pinned to its newest line. Splitting by flex basis rather than by content keeps the pair stable as the conversation grows: the dialogue never collapses under a long log, or the reverse.

**The JARVIS rail** (right, fixed 320px, on the panel ground, separated by a one-pixel left hairline) stacks the field, the current entry's readout, and the instrumentation. The field is a fixed-height panel (`clamp(196px, 30vh, 288px)`) on the black ground; the readout and the numbers scroll under it in their own box, so a short window never clips the last panel out of reach, and the numbers are pinned to the rail's bottom with `margin-top: auto` when there is room.

The composer is pinned to the bottom of the shell, always present, on the panel ground with a one-pixel top border.

Spacing is a flat set of rem values with no scale ladder — `0.125rem` through `2rem` — plus two structural gaps that are not padding: catalog rows are separated by `gap: 1px`, and the nav row grid uses `grid-template-columns: 2.75rem 1fr` with `gap: 0.5rem` to align the FAC column independently of the variable-width preview text. The log body is a three-column grid — time, tag, text — at `4.25rem 2.25rem minmax(0, 1fr)`.

**Responsive:** three queries, and they overlap. At `max-width: 1024px` the columns stack, the shell grows, the index becomes a full-width band capped at `30vh`, the conversation keeps a bounded height (`68vh`, min 360px) so its panels still scroll, and the rail becomes a row with the field (240px) beside the readout and the numbers. At `max-width: 900px` the rail stacks again and the field goes full width at `44vw`. At `max-width: 640px` the header and composer stack vertically and the input and every button take full width. There is no container query, no grid system beyond the nav row and the log row, and no max-width wrapper: the shell always fills the viewport.

## Elevation & Depth

The interface has two depths and one glow. The CSS chrome is flat: matte black for the field and the shell, panel void for every raised surface, and separation carried by a one-pixel hairline — a drawn line at 1.66:1, not a contrast boundary. All elevation is glow, and it lives in the canvas field alone: spectral bars cast a `shadowBlur` of `5 + magnitude × 9` in their own colour, and the core casts 18. Nothing in the stylesheet uses `box-shadow`, `text-shadow`, `backdrop-filter`, or translucency.

**The Flat-Chrome Rule.** Surfaces are flat at rest. Hover adds exactly one step (panel void → `hsl(0, 0%, 15%)`), a 1.15:1 lift visible as a change of surface, not a glow. If a new surface needs to read as raised, add a tone or a hairline — never a shadow.

**The Two-Tone Rule.** There are exactly two ground values in the interface: `#000000` for the field and the shell, `hsl(0, 0%, 10%)` for panels. A third background tone is a new design decision, not an implementation detail.

## Shapes

Every control, panel, strip and readout is square: `border-radius: 0` is declared explicitly on the status pill, catalog buttons, colour strip, composer buttons, composer input, notices, errors, and their cells. The single exception in the system is the WebKit scrollbar thumb at 4px, because a scrollbar thumb is a browser affordance rather than a designed element; Firefox uses `scrollbar-width: thin` with `scrollbar-color` from the palette.

The form language is thin and honest: one-pixel strokes in hairline on square boxes. The only geometry beyond the box is the field itself — two concentric guide rings, 72 radial bars, and a sweep wedge drawn on canvas.

## Components

### Status Pill
Engraved, square, and the one place connection state is spelled out.
- **Shape:** `border-radius: 0`, `border: 1px solid var(--color-border)`, `min-width: 96px`, padding `0.5rem 0.75rem`, uppercase label.
- **States:** `connected` takes Signal Blue border and text; `disconnected` takes Cut Red. The base pill keeps the default border.

### Turn Index (left column)
A plain web list, never a costume. Rows are `<li>` buttons in a `<ul>`.
- **Shape:** `display: grid`, `grid-template-columns: 2.75rem 1fr`, `align-items: baseline`, `gap: 0.5rem`, padding `0.375rem 0.5rem`, transparent background, `border-left: 1px solid transparent`, `border-radius: 0`. Rows are separated by `gap: 1px`.
- **FAC cell:** Azeret Mono, 0.75rem, `font-variant-numeric: tabular-nums`, zero-padded to three digits.
- **Preview cell:** display face at 0.75rem, truncated with `text-overflow: ellipsis` and `white-space: nowrap`.
- **Rest:** Etched Gray text. **Hover:** Plot Ink text over the one-step lift (`hsl(0, 0%, 15%)`). **Active (`aria-current="true"`):** Plot Ink text and an Amber Signal left border — the active entry is marked by position, not by a filled block. **Focus:** the same lift plus `outline: 1px solid var(--color-thinking)` with `outline-offset: 2px`.
- **Cut:** the preview is struck through with a one-pixel Cut Red line and the FAC turns Cut Red; a visually hidden `interrupted` label carries the same fact to assistive technology. The strike is permanent.

### Entry Readout (JARVIS rail, under the field)
The current entry's block: number, colour strip, language mark, timings.
- **Number:** 2.5rem Archivo semibold, line-height 1, tracking -0.03em, in Plotter White. `—` when there is no entry yet.
- **Colour strip:** a 3px full-width rectangle whose background is the live phase colour (`idle`, `transcribing`, `thinking`, `speaking`). A cut is never a phase on the strip. A visually hidden `role="status"` label beside it names the phase in words (Idle / Listening / Thinking / Speaking), so the colour is never the only carrier of the state.
- **Language mark:** `ES` / `EN` from the reply's own words, `··` when undecidable — engraved Archivo label. It identifies the answering voice; it never claims a translation, because the product does not translate.
- **Timings:** a 2-column grid of STT, LLM, TTS and Total in Azeret Mono caption size.

### Instrumentation Panels
Two quiet panels in the JARVIS rail, under the readout and pinned toward the rail's bottom by `margin-top: auto`.
- **Shape:** panel void background, `1px solid var(--color-border)`, `border-radius: 0`, `overflow: hidden`.
- **Heading:** flex row with a bottom hairline; the right-hand status (`LIVE · active`, `off`) is a caption in Etched Gray.
- **Body:** a 2-column `<dl>` grid; terms are captions in Etched Gray, values are Azeret Mono with `font-variant-numeric: tabular-nums`. Unmeasured values are an em dash, never a zero.
- **Character:** always present, never a modal, never a toggle that hides the numbers.

### Composer
Pinned to the bottom of the shell, always present, on the panel ground with a one-pixel top border. The input (panel ground, hairline border, body size, caret and selection in the palette) flexes beside five square mono-labelled buttons:
- **Send (`type="submit"`):** filled Plotter White, text Matte Black; hover and focus invert to panel void with Plotter White text — the fill is lost, not brightened. Disabled when the gateway is down, the input is empty, or a request is active.
- **Live experimental / Live on:** panel void at rest; Cut Red fill while a stream is open, stepping down to `hsl(0, 80%, 40%)` on hover. Disabled while a turn is in flight, so toggling it can never cut an active request.
- **Hold to Talk / Release:** panel void at rest; Cut Red fill while it is held and audio is being captured. The hold works with the pointer and with the keyboard (Space or Enter while focused); moving focus away stops the capture, and releasing finalizes the turn with the audio already captured.
- **Mic switch (`role="switch"`, `aria-checked`):** the explicit microphone gate. Signal Blue fill when armed — the microphone's colour, never red — panel void at rest. Turning it off stops capture immediately and finalizes the in-flight turn with the audio already captured.
- **Stop:** panel void, enabled only while a request is active.
- **Disabled controls** drop to 0.5 opacity with a `not-allowed` cursor. **Focus** on every control is `outline: 1px solid var(--color-thinking)` with `outline-offset: 2px`.

### Approval Gate (above the composer)

When a tool call needs approval — every host tool, or every tool when
`TOOLS_APPROVAL=all` — the gate panel slides into view, fixed above the composer
and on the panel ground with a one-pixel bottom border. It is the one place in
the interface that takes protected focus: `Deny` is the default, so a stray
Enter picks the safe answer.

- **Shape:** square corners, zero radius. The command is shown in Azeret Mono
  body size with word-wrap, so the exact text the model is asking to run is
  legible at a glance. The working directory and the reason for the gate sit
  beneath it in Etched Gray caption.
- **Actions:** `Approve` (Plotter White fill, Matte Black text) and `Deny`
  (panel void, Etched Gray text) side by side, plus `Deny & stop` in Cut Red
  raised text for the case where the owner wants to refuse and halt the whole
  turn. `Deny` is focused first and holds focus after a tab, so keyboard navigation
  lands on the safe answer.
- **Timeout:** if nobody answers within 60 s, the gate auto-denies and the panel
  dismisses. Closing the page denies everything pending.
- **Why here:** the voice cannot approve. A destructive action must be a screen
  decision, taken from the exact text on display, never from a spoken word that a
  barge-in might mishear.

### Dialogue (center column, top)
The conversation as plain entries — a role line and the words, never chat bubbles. It is the larger of the two center panels (`flex: 3`) and scrolls on its own, always landing on its newest entry so the latest exchange is the one on screen.
- **Shape:** panel ground, a heading row with a bottom hairline, and a scrolling body with `padding: 0.5rem 0.75rem`.
- **Heading:** engraved `Dialogue` on the left; on the right, a tabular count (`N turns`, `empty`) in Etched Gray.
- **Entry:** `border-left: 1px solid transparent`, `padding-left: 0.5rem`, separated by `0.625rem`. The entry the conversation is on right now takes the Amber Signal left border — the same mark the index uses, so the current turn is marked by position in both places.
- **Role line:** Azeret Mono caption, engraved caps, Etched Gray — `You` or `Assistant`. A speech-derived turn carries a `mic` mark in Signal Blue, Lifted, beside the role.
- **Text:** body size (0.9375rem), Plotter White, `overflow-wrap: break-word`. A transient entry (a partial transcript still settling) reads in Etched Gray; an entry with no words yet shows a dim `…`.
- **Not a live region:** streaming deltas would flood a screen reader token by token. A visually hidden `role="status"` announcer carries the turn lifecycle instead: "Agent is responding", "Response complete", "Response interrupted", "Response failed".

### Activity Log (center column, bottom)
The turn pipeline as it happens: one line per event, the honest record of what the agent did. It is the smaller panel (`flex: 2`), scrolls on its own, and like the dialogue it follows its newest line.
- **Shape:** panel ground, a heading row with a top and bottom hairline, and a scrolling body sharing the dialogue's padding.
- **Heading:** engraved `LLM activity` on the left; on the right, a tabular count (`N events`, `idle`).
- **Row:** a three-column grid — time, tag, text — at `4.25rem 2.25rem minmax(0, 1fr)`, Azeret Mono caption size, rows separated by `gap: 1px`.
  - **Time:** `HH:MM:SS`, zero-padded and locale-independent, Etched Gray, tabular figures.
 - **Tag:** the event's kind, engraved caps, on the same phase code the field and the colour strip use — `SYS` Etched Gray, `STT` Signal Blue Lifted, `LLM` Amber Signal, `TTS` Bone, `CUT` Cut Red Lifted, `ERR` Error Ink. When the agent is acting the tool lines use `TOOL` in Amber Signal (the acting phase reuses thinking), and the approval gate uses `GATE` in Amber Signal as well: approval is a sub-state of acting. The lifted steps exist because the base blue and red fall under AA at this size on the panel ground.
 - **Text:** Plotter White, `overflow-wrap: anywhere`; a `SYS` line reads in Etched Gray so the pipeline's own words stay loudest.
- **What it logs, and only what is real:** the connection lifecycle, the session's start, `STT` partial and final transcripts, `LLM` `in`/`out`/`done` (the model's own streamed words, coalesced onto one line), `TTS` start, segment count and end, `TOOL` calls with their arguments and outcome (ok / refused / denied / error / cancelled / timeout), `GATE` requests and the user's approve / deny decision, barge-in and user interruptions as `CUT`, and failures as `ERR`. A line that belongs to an open stream — a partial transcript, a token stream — replaces itself instead of appending, so a growing stream stays one line. It keeps its newest 200 lines.

### Notices and Errors
Both square, padded `0.5rem 0.75rem`, after the composer, each a duotone rather than chromatic: a blue-grey surface with pale blue ink for transient status, a red-grey surface with pale red ink for failures. The recording status notice ("Recording...", "Listening...") carries `role="status"`, so the capture arc is announced. When the browser's autoplay policy holds a reply's audio, the notice names the problem and the recovery, beside the `Play audio response` button.

### The Living Core (signature component)
The agent's presence: a `<canvas>` in a fixed-height panel at the top of the JARVIS rail, `aria-hidden="true"`. It rests unless there is a signal, so it reads as activity rather than as an ornament.
- **At rest (no signal):** two guide rings and a small still core at 45% alpha in the phase colour. No sweep turns, no bar is drawn, and the draw loop stops — idle and the whole thinking phase cost no motion.
- **Guide rings:** two concentric circles — outer at 0.94 × half the field's shorter side, inner at 0.3 × that — stroked at one pixel in Plot Ink at 10% alpha.
- **Radar sweep (active):** 22 trailing wedges over a 0.85π span in the phase colour, alpha fading `0.045 × (1 − slice/22)`, plus a 1px leading edge at 70% alpha. It turns only with signal, faster as the signal grows: `0.005 + level × 0.035` radians per frame, so the motion encodes amplitude rather than a constant rotation.
- **Spectrum (active):** 72 bars with round caps, growing outward from the inner ring by the FFT magnitude each bar measures; a bar below 0.012 rests. Width is `max(1.5, chord × 0.36)`. Each bar glows with `shadowBlur: 5 + magnitude × 9` in its own colour: a steel ramp while idle, a blue ramp while transcribing, an amber ramp while thinking, and the drifting full spectrum while speaking.
- **The core (active):** a lamp whose radius breathes with the overall amplitude — `innerRadius × (0.3 + level × 0.5)` — drawn twice: a 16%-alpha halo at blur 18 and a 90%-alpha core, both in the phase colour.
- **Coming to rest:** when a signal leaves, the bars fall with the existing peak-hold decay and the field keeps animating until they are negligible, then stops. Nothing snaps off mid-shape.
- **Data source:** real and measured only. The microphone capture graph feeds the field while the user talks (push-to-talk builds a metering graph over its stream that measures and never plays), and the reply's playback graph feeds it while the agent speaks. No synthetic waveform, no random walk, no placeholder shape.
- **Reduced motion:** under `prefers-reduced-motion: reduce` the field draws a single still frame and never animates, in every state.

## Do's and Don'ts

### Do:
- **Do** drive the field from real FFT data only — microphone and playback analysers — and let a bar rest when its magnitude falls below 0.012.
- **Do** let the field rest when nothing is sounding: motion is a signal, and idle and the whole thinking phase carry none.
- **Do** let the speaking phase own the full spectrum, and keep every other phase in its single hue.
- **Do** keep the dialogue and the activity log scrolling to their newest line, so the latest exchange is always the one on screen.
- **Do** give the JARVIS rail its own scroll, so a short window never hides the instrumentation behind the composer.
- **Do** keep the chrome flat: two ground tones, one-pixel hairlines, zero radius, and glow only in the canvas.
- **Do** set every number in Azeret Mono with `font-variant-numeric: tabular-nums`, zero-padded to three digits for FAC numbers.
- **Do** write system text in engraved tracked caps, and reserve sentence case for words the user or the agent said.
- **Do** show an em dash for an unmeasured value instead of a zero or a spinner.
- **Do** keep the Mic switch in Signal Blue — the microphone's colour — and Cut Red for streaming and cut states.
- **Do** show the approval gate as a panel above the composer with the exact command text in monospace, and make Deny the default so a stray Enter is always the safe answer.
- **Do** arm the playback graph on every gesture that can begin a turn, so the first reply never waits on the browser's autoplay policy.

### Don't:
- **Don't** add corner radius to anything; the only rounded element in the system is the browser's scrollbar thumb.
- **Don't** put a `box-shadow`, blur, gradient, or translucent surface in the CSS chrome — glow belongs to the field alone.
- **Don't** render the conversation as chat bubbles, or the microphone as a round button. An answer is the entry under the current FAC number.
- **Don't** use the Cut Red token for anything but an interruption or an open stream — not errors in general, not hover, not emphasis.
- **Don't** keep the field turning when there is no signal, or animate the bars from a random walk or a constant waveform; the sweep advances only while a signal feeds it.
- **Don't** let the dialogue or the log be clipped by its container: both scroll on their own and both follow their newest line.
- **Don't** log anything the backend did not produce — the activity log is a record of what happened, never a narration.
- **Don't** take a system face for the display voice or the numerals. Both faces are self-hosted woff2 files, and the numerals must stay tabular in every readout.
- **Don't** translate. The language mark names the answering voice; the product does not translate.
- **Don't** let an approval gate be answered by voice — a spoken "yes" never unlocks a destructive action; the decision is screen-only.
- **Don't** fetch fonts at runtime, and don't imply a capability the backend lacks — the interface shows only the states the product can actually produce.
