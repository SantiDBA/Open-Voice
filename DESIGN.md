---
name: Open Voice — Catálogo de fábrica
description: "A factory catalog for a speaking agent: matte black ground, one-pixel plot ink, and exactly one industrial color per state."
colors:
  ground: "#000000"
  panel: "hsl(0, 0%, 10%)"
  border: "hsl(0, 0%, 20%)"
  ink: "hsl(0, 0%, 80%)"
  text-primary: "hsl(0, 0%, 95%)"
  text-secondary: "hsl(0, 0%, 70%)"
  phase-idle: "hsl(210, 10%, 40%)"
  phase-transcribing: "hsl(210, 80%, 50%)"
  phase-thinking: "hsl(50, 80%, 50%)"
  phase-speaking: "hsl(40, 60%, 80%)"
  phase-cut: "hsl(0, 80%, 50%)"
  surface-hover: "hsl(0, 0%, 15%)"
  cut-deep: "hsl(0, 80%, 40%)"
  notice-surface: "hsl(210, 20%, 15%)"
  notice-ink: "hsl(210, 70%, 80%)"
  notice-border: "hsl(210, 50%, 30%)"
  error-surface: "hsl(0, 50%, 15%)"
  error-ink: "hsl(0, 70%, 70%)"
  error-border: "hsl(0, 50%, 30%)"
typography:
  display:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 6rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  readout:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 5rem
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  body:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 1.125rem
  label:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 0.875rem
    fontWeight: 500
    letterSpacing: "0.05em"
  caption:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 0.75rem
    fontWeight: 400
  preview:
    fontFamily: 'Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 0.8125rem
    fontWeight: 400
  composer-control:
    fontFamily: 'Azeret Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: 0.875rem
    fontWeight: 500
    letterSpacing: "0.08em"
  mono-meta:
    fontFamily: 'Azeret Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: 0.8125rem
    fontWeight: 400
    letterSpacing: "0.06em"
  mono-number:
    fontFamily: 'Azeret Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    fontSize: 0.75rem
    fontWeight: 400
    fontFeature: '"tnum"'
rounded:
  scrollbar-thumb: "4px"
spacing: {}
components:
  button-submit:
    backgroundColor: "{colors.text-primary}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "0"
    padding: "0.75rem 1.5rem"
    height: "auto"
  button-submit-hover:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    rounded: "0"
    padding: "0.75rem 1.5rem"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.composer-control}"
    rounded: "0"
    padding: "0.75rem 1.5rem"
  button-secondary-hover:
    backgroundColor: "hsl(0, 0%, 15%)"
    textColor: "{colors.text-primary}"
    rounded: "0"
    padding: "0.75rem 1.5rem"
  button-live-on:
    backgroundColor: "{colors.phase-cut}"
    textColor: "{colors.text-primary}"
    typography: "{typography.composer-control}"
    rounded: "0"
    padding: "0.75rem 1.5rem"
  button-live-on-hover:
    backgroundColor: "{colors.cut-deep}"
    textColor: "{colors.text-primary}"
    rounded: "0"
    padding: "0.75rem 1.5rem"
  button-recording:
    backgroundColor: "{colors.phase-cut}"
    textColor: "{colors.text-primary}"
    typography: "{typography.composer-control}"
    rounded: "0"
    padding: "0.75rem 1.5rem"
  nav-entry:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.preview}"
    rounded: "0"
    padding: "0.5rem 0.625rem"
    height: "auto"
  nav-entry-active:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.preview}"
    rounded: "0"
    padding: "0.5rem 0.625rem"
  input-message:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "0"
    padding: "0.75rem 1rem"
    width: "min 200px base, 100% at 640px"
  status-connected:
    backgroundColor: "transparent"
    textColor: "{colors.phase-transcribing}"
    typography: "{typography.label}"
    rounded: "0"
    padding: "0.5rem 0.75rem"
    width: "min 96px"
  color-strip:
    backgroundColor: "{colors.phase-idle}"
    textColor: "{colors.text-primary}"
    rounded: "0"
    height: "4px"
  readout-fac:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    typography: "{typography.readout}"
    rounded: "0"
  latency-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    typography: "{typography.mono-number}"
    rounded: "0"
    padding: "0.75rem"
  notice:
    backgroundColor: "{colors.notice-surface}"
    textColor: "{colors.notice-ink}"
    rounded: "0"
    padding: "1rem"
  error:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error-ink}"
    rounded: "0"
    padding: "1rem"
---

# Design System: Open Voice — Catálogo de fábrica

## Overview

**Creative North Star: "The Factory Catalog"**

This world treats a conversation as a numbered factory catalog. Every turn is an entry with a
FAC number; the agent's presence is not a widget in a corner but the work area itself, drawn as a
hairline radar plot from real microphone amplitude. State is spoken in an industrial color code
rather than in words, and system text is engraved into the page as tracked capitals. The ground is
matte black and the plot ink is one pixel wide, so most of the screen is deliberately unprinted.
The design is dense rather than explanatory: the user already knows the product, and the interface's
job is to prove what just happened, measured.

Two category defaults are refused. There are no chat bubbles and no round microphone button — an
answer is the entry under the current number, not a speech balloon. And there is no neon sci-fi
HUD: nothing glows, nothing is translucent, nothing casts a shadow. Depth is a two-step tonal
floor between black and a very dark gray panel. The interface is a sheet of plotted paper, not a
head-up display.

**Key Characteristics:**
- Matte black ground with one hairline of plot ink; the emptiness is the composition.
- One colour per product state, with red reserved exclusively for an interruption.
- Engraved tracked capitals for every system word; tabular monospace for every number.
- Zero corner radius on any control, panel, strip or readout.
- The plot is driven by real amplitude and rests at the baseline when there is no signal to read.
- Depth is tonal (two steps), never shadow, blur or translucency.
- An interruption is permanent: the entry is struck and stays struck in the index.

## Colors

A four-channel industrial colour code plus a grayscale floor, all sitting on matte black.

### Primary

- **Signal Blue** (`hsl(210, 80%, 50%)`): the colour of the microphone capturing. It is the
  `transcribing` phase code on the colour-code strip, the connected state of the status pill, and
  the background of text selection (with `ground` as the selected text colour). It measures
  5.27:1 on `--color-ground`, which clears AA; on the panel ground it measures 4.37:1, so check the
  surface under it before using it as small text.

### Secondary

- **Amber Signal** (`hsl(50, 80%, 50%)`): the `thinking` phase — the model streaming while no audio
  exists yet. It also draws the current catalog entry's left border and the keyboard focus outline.
- **Bone** (`hsl(40, 60%, 80%)`): the `speaking` phase — synthesized audio playing. The warmest and
  quietest code in the set; at 14.75:1 on black it is the most legible.

### Tertiary

- **Cut Red** (`hsl(0, 80%, 50%)`): reserved for an interruption or a stopped playback, and nothing
  else. It fills the live-on and recording composer controls, marks the strike drawn through a cut
  entry and its FAC number in the index, and colours the colour-code strip for the `cut` phase.
- **Steel Grey** (`hsl(210, 10%, 40%)`): the `idle` phase — nothing is happening. Deliberately
  desaturated so that idleness reads as absence of signal rather than as a state that needs
  attention.

### Neutral

- **Matte Black** (`#000000`): the ground of the shell, the plot field, and the foreground colour of
  a filled primary control.
- **Panel Void** (`hsl(0, 0%, 10%)`): the single elevated surface. Left column, right rail, composer,
  the input, and the instrumentation panels all sit on it. Hover adds exactly one step
  (`hsl(0, 0%, 15%)`), which is a 1.15:1 lift — visible as a change in surface, not as a glow.
- **Hairline Divider** (`hsl(0, 0%, 20%)`): every border in the system is this colour at one pixel.
  At 1.66:1 against black it is a drawn line, not a contrast-bearing edge.
- **Plot Ink** (`hsl(0, 0%, 80%)`): the hairline itself. Four concentric radar rings, twelve radial
  hairlines at 30°, and the live trace are all this colour at one pixel width. It doubles as the
  hover colour for catalog entries and composer buttons.
- **Plotter White** (`hsl(0, 0%, 95%)`): primary text.
- **Etched Gray** (`hsl(0, 0%, 70%)`): secondary text, placeholders, and inactive catalog entries.

### Named Rules

**The One Colour Per State Rule.** Every product state owns exactly one colour, and the same colour
must never mean two things. A new state means a new token, not a second use of an existing one. The
strip in the right rail is the only place the current phase's colour appears as a large fill.

**The Red Is Not A Button Rule.** Red is reserved for a cut. A cut is a fact about the conversation,
so it is permanent: the entry is struck through with a one-pixel red line, the FAC turns red, and
both stay struck for the life of the session. Nothing transient, decorative, or merely loud may be
red.

**The Hairline Rule.** Lines are one physical pixel and `--color-border`. Thickness is not a way to
express importance; position and colour are.

## Typography

**Display Font:** Archivo (400 and 600, self-hosted woff2) with `ui-sans-serif, system-ui,
-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
**Body Font:** Archivo (same stack — there is no separate body face)
**Label/Mono Font:** Azeret Mono (400 and 500, self-hosted woff2) with `ui-monospace,
SFMono-Regular, Menlo, Monaco, Consolas, monospace`

**Character:** One grotesque carries every spoken and product word, so the interface reads as a
single printed voice. Azeret Mono is reserved strictly for numerals, FAC numbers and control
labels: anything a person might compare against something else. The pair is deliberately
non-decorative — no italic, no serif, no optical sizing flourishes.

### Hierarchy

- **Display** (600, 6rem, line-height 1.25, tracking -0.03em): the product name, once, in the header.
  It is the largest type on the page and it is never reused as a section heading.
- **Readout** (600, 5rem, line-height 1, tracking -0.03em): the current entry's FAC number, set
  large in the right rail. This is the world's real headline — the number is the subject of the
  screen, not the title of it.
- **Body** (400, 1.125rem, line-height 1.5): document default, the subtitle under the product name,
  and the composer text input.
- **Label** (500, 0.875rem, tracking 0.05em, uppercase): engraved system caps. The language mark,
  the `Turns` column heading, the panel headings (`Latency`, `Voice activity`), and the Send button.
- **Caption** (400, 0.75rem): definition terms in the instrumentation panels and the status text
  beside a panel heading. Not uppercase — it is read, not engraved.
- **Preview** (400, 0.8125rem): the catalog entry's preview line in the index, truncated with an
  ellipsis.
- **Composer Control** (Azeret Mono 500, 0.875rem, tracking 0.08em, uppercase): every composer button
  label (`Send`, `Live experimental`, `Hold to Talk`, `Stop`).
- **Mono Meta** (Azeret Mono 400, 0.8125rem, tracking 0.06em): the empty-index message.
- **Mono Number** (Azeret Mono 400, 0.75rem, `font-variant-numeric: tabular-nums`): every measured
  latency value and the FAC number in the index. Tabular figures are what make a column of timings
  legible; proportional digits in a readout are a bug, not a style.

### Named Rules

**The Engraved Rule.** System text is uppercase with wide tracking (0.05em for Archivo labels, 0.08em
for monospace control labels). Sentence case is reserved for content that came from speech or from
the user.

**The Numbering Rule.** Every number is set in Azeret Mono with `font-variant-numeric: tabular-nums`,
and FAC numbers are zero-padded to three digits (`007`, not `7`) so the column does not reflow as
the catalog grows. Never style a numeral in the display face.

## Layout

The shell is a vertical flex column at `min-height: 100vh`: header, meta line, work area, composer.
The work area (`.main`) is a horizontal flex with `overflow: hidden`, in three columns.

- **Left column, catalog index:** `width: 20%`, `min-width: 180px`, `max-width: 220px`, on the panel
  ground, scrolling vertically.
- **Center, work area:** `flex: 1`, `position: relative`, `overflow: hidden`, on matte black. This is
  where the plot owns the field at full height. The canvas fills it at 100%×100% and resizes to its
  client box.
- **Right rail:** fixed `width: 260px`, on the panel ground, scrolling vertically. The current entry
  readout sits at the top; instrumentation is pushed to the bottom by `margin-top: auto` so it
  rides as one quiet line under the readout.
- **Composer:** pinned to the bottom of the shell, always present, on the panel ground with a one-pixel
  top border. It is never hidden or overlaid.

Spacing is a flat set of rem values with no scale ladder — `0.25rem`, `0.5rem`, `0.75rem`, `1rem`,
`1.5rem`, `2rem` — plus two structural gaps that are not padding: the index rows are separated by
`gap: 1px`, and the nav row grid uses `grid-template-columns: 3.25rem 1fr` with `gap: 0.75rem` to
align the FAC column independently of the variable-width preview text. Containers use `1.5rem`
padding (header, left column, right rail, composer); dense readouts use `0.5rem`–`0.75rem`. Panel
padding is `0.75rem`; their definition-list cells are `0.5rem` inside it.

**Responsive:** three media queries, and they overlap.

- `max-width: 1024px` — the work area becomes a column; the left column and right rail go full width
  with `height: 200px` each and switch their side borders to horizontal ones; the plot keeps
  `min-height: 300px`.
- `max-width: 900px` — reinforces the stacking (the header comment says three columns do not survive
  a narrow viewport), sets `overflow: visible` so the shell grows instead of clipping the readout
  behind the composer, gives the left column `max-height: 30vh`, and raises the plot's `min-height`
  to `320px`. Because this query is narrower than the one above it, on viewports between 900px and
  1024px both apply and the later declarations win: the shell grows, the rails drop their fixed
  heights, and the plot floor is 320px.
- `max-width: 640px` — the header and the composer stack vertically; the input and every button take
  `width: 100%`.

There is no container query, no grid system beyond the nav row, and no max-width wrapper: the shell
always fills the viewport.

## Elevation & Depth

**This system has no shadows.** There is no `box-shadow`, `text-shadow`, `drop-shadow` or
`backdrop-filter` anywhere in the stylesheet. Depth is tonal and binary: matte black for the field and
the shell, panel void for every raised surface, and exactly one hover step (`hsl(0, 0%, 15%)`) between
rest and hover. At 1.15:1 that step is a change of surface, not a lift. Separation between regions is
carried by a one-pixel `--color-border` line and nothing else.

**The Flat-By-Default Rule.** Surfaces are flat at rest. Nothing hovers above the page until the
pointer or the state asks for it, and even then the change is a fill, not a shadow. If a new surface
needs to read as raised, add a tone or a hairline — never a shadow.

**The Two-Tone Rule.** There are exactly two ground values in the interface: `#000000` for the field
and the shell, `hsl(0, 0%, 10%)` for panels. A third background tone is a new design decision, not an
implementation detail.

## Shapes

Every control, panel, strip and readout is square: `border-radius: 0` is declared explicitly on the
status pill, catalog buttons, colour strip, composer buttons, composer input, notices and errors,
latency/VAD panels, and their definition-list cells. Nothing is clipped, nothing is rounded, nothing
is pill-shaped.

The single exception in the stylesheet is the WebKit scrollbar thumb at `4px`, because a scrollbar
thumb is a browser affordance rather than a designed element; Firefox uses `scrollbar-width: thin`
with `scrollbar-color: var(--color-border) var(--color-background-panel)`.

The form language is thin and honest: one-pixel strokes in `--color-border` on a square box. The only
geometry beyond the box is the hairline radar plot itself — four concentric rings and twelve radial
lines drawn on canvas at one pixel — and the 4px colour-code strip, which is a rectangle and nothing
else. The strip's `border-radius: 0` is stated even though it is a bare `<div>`, because that is the
world's intent made explicit.

## Components

### Status Pill

Engraved, square, and the one place connection state is spelled out.

- **Shape:** `border-radius: 0`, `border: 1px solid var(--color-border)`, `min-width: 96px`,
  padding `0.5rem 0.75rem`, uppercase label at 0.875rem / 500 with 0.05em tracking.
- **Variants:** `.connected` takes border and text `Signal Blue`; `.connecting` and
  `.reconnecting` take `Amber Signal`; `.disconnected` takes `Cut Red`. The unconnected base pill
  keeps the default border.
- **Note:** only the `connected` class is applied at runtime; the `connecting`, `reconnecting` and
  `disconnected` rules are authored but currently unexercised.

### Composer Buttons

Four ordinary bordered buttons in a row. No microphone glyph, no waveform, no circular control.

- **Shape:** `border-radius: 0`, `1px solid var(--color-border)`, padding `0.75rem 1.5rem`, mono
  label at 0.875rem / 500, 0.08em tracking, uppercase, `flex: 0 0 auto`.
- **Send (`type="submit"`):** filled with `Plotter White`, text `Matte Black`. On hover and focus it
  inverts to `Panel Void` with `Plotter White` text — the fill is lost, not brightened. Disabled when
  the gateway is down, the input is empty, or a request is active; the later rule for
  `.composer button:disabled` drops opacity to `0.5` and the cursor to `not-allowed`.
- **Secondary:** filled `Panel Void`, text `Plotter White`; hover and focus step to `hsl(0, 0%, 15%)`.
  Used for Live-off, Stop, and Reconnect now.
- **Live-on (`.live-on`) and Recording (`.recording`):** filled `Cut Red` with `Plotter White` text;
  hover and focus step down to `cut-deep` (`hsl(0, 80%, 40%)`) rather than up. These are the two
  states where red is legitimate: the microphone is open and audio is being captured.
- **Focus:** `outline: 1px solid var(--color-thinking)` with `outline-offset: 2px`.
- **An earlier, conflicting declaration also exists** for the same selector: it would put the label
  in Azeret Mono at 0.8125rem with 0.08em tracking, colour `Plotter White` on transparent, and a
  hover that shifts the border to `Plot Ink`. Because it is declared before the effective block, the
  block above wins on every property they share (font, size, background, padding) except
  letter-spacing, where 0.08em survives.

### Text Field

- **Style:** `background-color: var(--color-background-panel)`, `border: 1px solid var(--color-border)`,
  `border-radius: 0`, padding `0.75rem 1rem`, `font-size: var(--size-body)` (1.125rem),
  `flex: 1 1 200px`, `min-width: 120px`. Placeholder is `Etched Gray`.
- **Focus:** no bespoke focus rule is declared; the caret and selection are restyled instead —
  `caret-color` follows `--color-text-primary`, and `::selection` fills with `Signal Blue` and sets
  text to `Matte Black`.
- **Responsive:** `width: 100%` at `max-width: 640px`.

### Catalog Index (the left column)

A plain web list, never a costume. Rows are `<li>` buttons in a `<ul>`.

- **Shape:** `display: grid`, `grid-template-columns: 3.25rem 1fr`, `align-items: baseline`,
  `gap: 0.75rem`, padding `0.5rem 0.625rem`, transparent background, `border-left: 1px solid
  transparent`, `border-radius: 0`. Rows are separated by `gap: 1px`.
- **FAC cell:** Azeret Mono, 0.8125rem, `font-variant-numeric: tabular-nums`, 0.04em tracking,
  zero-padded to three digits.
- **Preview cell:** display face at 0.8125rem, truncated with `text-overflow: ellipsis` and
  `white-space: nowrap`.
- **Rest:** `Etched Gray` text. **Hover:** text and border become `Plot Ink`.
- **Active (`aria-current="true"`):** text becomes `Plot Ink` and the left border becomes
  `Amber Signal` — the active entry is marked by position, not by a filled block.
- **Cut (`.struck`):** the preview is struck through with `text-decoration-thickness: 1px` and
  `text-decoration-color: var(--color-cut)`, and the FAC turns `Cut Red`. A visually hidden
  `interrupted` label carries the same fact to assistive technology. The strike is permanent.
- **Focus:** `outline: 1px solid var(--color-thinking)`, `outline-offset: 2px`.
- **Empty state:** one line in Azeret Mono at 0.8125rem / 0.06em tracking, `Etched Gray`.

### The Plot (signature component)

The agent's presence, and the only element that owns the work area.

- **Form:** a `<canvas>` filling the center column, `aria-hidden="true"`. Four concentric rings and
  twelve radial hairlines at 30° increments, all stroked at `lineWidth = 1` in `hsl(0, 0%, 80%)`.
- **Data source:** real microphone amplitude only. An `AnalyserNode` is tapped from the same capture
  source the VAD already runs on, before the monitoring gain silences it; `fftSize = 1024`;
  `getFloatTimeDomainData` is reduced to RMS, then `level = min(0.92, sqrt(rms) * 1.15)` so quiet
  speech is visible without letting peaks clip.
- **Signal-driven, not clock-driven:** the sweep advances by `0.004 + level * 0.09` radians per
  sample — louder speech draws a wider arc, so the trace's *shape* encodes the sound. A buffer of up
  to 200 points is drawn as a single stroked path.
- **The baseline rule:** when `level <= 0.004` the buffer is emptied and the trace rests at the
  baseline. It does not idle-animate, drift, or draw a placeholder shape. When no signal exists, the
  field shows nothing.
- **Reduced motion:** under `prefers-reduced-motion: reduce` the animation frame is cancelled, the
  plot stops updating, and only the static grid is drawn.
- **Canvas ink:** the stroke colour is written as the literal `hsl(0, 0%, 80%)` with a comment naming
  `--color-ink`. It matches the token; it just does not reference it.

### Entry Readout

The right rail's top block: number, colour strip, language mark, timings.

- **Number:** 5rem Archivo semibold, line-height 1, tracking -0.03em, in `Plotter White`. `—` when
  there is no entry yet.
- **Colour strip:** a 4px full-width rectangle whose background is `var(--color-<phase>)`; phases are
  `idle`, `transcribing`, `thinking`, `speaking`. There is a `[data-phase="cut"]` rule painting it
  `Cut Red`, but the computed phase is never `cut` — the current phase describes the live request,
  not the selected entry — so the strip never shows red today.
- **Language mark:** `ES` / `EN` from the reply's own words, `··` when undecidable, set as an engraved
  Archivo label. It identifies the answering voice; it never claims a translation, because the product
  does not translate.
- **Timings:** a 2-column grid (`repeat(2, minmax(0, 1fr))`, `gap: 0.5rem 1rem`) of STT, LLM, TTS and
  Total in Azeret Mono at 0.75rem. These cells do not currently declare `tabular-nums` (only the
  instrumentation panel and the FAC column do).

### Instrumentation Panels

Two quiet panels in the right rail, pinned to its bottom.

- **Shape:** `Panel Void` background, `1px solid --color-border`, `border-radius: 0`, `margin-bottom:
  1rem`, `overflow: hidden`.
- **Heading:** flex row, `gap: 0.75rem`, padding `0.5rem 0.75rem`, Archivo label at 0.875rem / 500,
  with a bottom hairline. The right-hand status (`LIVE · active`, `calibrating 42%`, `off`) is a
  0.75rem caption in `Etched Gray`.
- **Body:** a 2-column `<dl>` grid, padding `0.75rem`, each cell `Panel Void` at `0.5rem` padding and
  square corners. Terms are 0.75rem `Etched Gray`; values are Azeret Mono 0.75rem with
  `font-variant-numeric: tabular-nums`. Unmeasured values are an em dash, never a zero.
- **Character:** always present, never a modal, never a toggle that hides the numbers.

### Notices and Errors

Both are square, padded `1rem`, `margin: 1rem 0`, `1px solid` their own border colour, and both are
duotone rather than chromatic: a blue-grey surface with a pale blue caption for transient status
(`Listening...`, `Transcribing...`), and a red-grey surface with a pale red caption for failures. They
sit after the composer, outside the work area.

## Do's and Don'ts

### Do:

- **Do** give a product state exactly one colour and carry it on the colour-code strip, then let the
  label do the explaining.
- **Do** reserve `Cut Red` for an interruption or an open microphone, and keep the strike permanent
  once a turn has been cut.
- **Do** set every number in Azeret Mono with `font-variant-numeric: tabular-nums`, zero-padded to
  three digits for FAC numbers.
- **Do** write system text in uppercase with wide tracking (0.05em Archivo, 0.08em monospace), and
  reserve sentence case for words the user or the agent said.
- **Do** let the plot rest at the baseline when there is no real signal, and drive its sweep from
  amplitude rather than from a clock.
- **Do** separate regions with a one-pixel `--color-border` line and the two ground tones.
- **Do** show an em dash for an unmeasured value instead of a zero or a spinner.
- **Do** show only the states the backend can actually produce: idle, transcribing, thinking,
  speaking, and cut. The product must never imply a capability the backend lacks.

### Don't:

- **Don't** add corner radius to anything. The only rounded thing in the system is the browser's
  scrollbar thumb.
- **Don't** add a shadow, a glow, a gradient, a blur or a translucent overlay to express depth, hover,
  focus or importance.
- **Don't** reuse a state colour for a second meaning, or reach for a phase colour as decoration or as
  a large fill outside the one-pixel or 4px marks it belongs in.
- **Don't** use red for anything that is not a cut or an open microphone — not errors in general, not
  hover, not emphasis.
- **Don't** animate the plot from a constant rotation, a random walk, or a synthetic waveform. If
  there is no signal, the field stays flat.
- **Don't** render the conversation as chat bubbles, or the microphone as a round button. An answer is
  the entry under the current FAC number.
- **Don't** turn instrumentation into a modal, a drawer, or something the user has to ask for.
- **Don't** translate. The language mark names the answering voice; the product does not translate.
- **Don't** take a system face for the display voice or the numerals. Both faces are self-hosted
  woff2 files, and the numerals must stay tabular in every readout.