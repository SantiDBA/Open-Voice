---
target: apps/web/app/page.tsx
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/santix/orca/projects/Open-Voice/apps/web/app/page.tsx"
target_fingerprint: "sha256:9def5f4b7f9768d85cab9b350a70272376e7923feead596d9c65fd7aec0701c4"
target_path: /home/santix/orca/projects/Open-Voice/apps/web/app/page.tsx
timestamp: 2026-10-06T03-48-18Z
slug: apps-web-app-page-tsx
closed: true
---
⚠️ DEGRADED: single-context (sub-agent B stopped early: tool permission denied; its detector and browser-overlay steps were re-run inline by the parent). Assessment A ran as an isolated sub-agent.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Exemplary instrumentation; docked: phase has no text equivalent, idle field animates without meaning |
| 2 | Match System / Real World | 3 | Turns, FAC numbers, barge-in language fit; the radar field is a borrowed trope, not the product's own metaphor |
| 3 | User Control and Freedom | 3 | Stop, real interruption, Mic switch, Reconnect now; docked: PTT not keyboard-cancellable, Live can barge-in unannounced |
| 4 | Consistency and Standards | 2 | Two mic controls in two colours; native Reconnect button; tabular figures applied inconsistently; doc/code drift |
| 5 | Error Prevention | 3 | Send/Stop disabled states correct; mic-off gates capture; docked: mid-turn Live toggle can destroy an in-flight turn |
| 6 | Recognition Rather Than Recall | 3 | Everything visible, no hidden modes; docked: colour-only phase state requires memorizing the hue code |
| 7 | Flexibility and Efficiency | 3 | Text + two voice paths, latency always at hand; docked: pointer-only PTT, no keyboard shortcut for Live |
| 8 | Aesthetic and Minimalist Design | 2 | Glow/rainbow at idle competes with the quiet instrumentation; busy where it should be empty, generic where it should be branded |
| 9 | Error Recovery | 3 | Plain-copy errors with consequences and a recovery action; docked: audio-block recovery is a subtle floating button |
| 10 | Help and Documentation | 3 | None needed for a single-user tool; empty-state line and inline notices carry it |
| **Total** | | **28/40** | **Good** |

## Design Specificity Verdict

**LLM assessment:** Mixed, and drifting toward generic. The catalog index (zero-padded FAC numbers in tabular Azeret Mono), the permanent one-pixel red strike for interrupted turns, the per-stage latency instrumentation, and the language mark derived from the reply's own words are genuinely authored for this product. But the signature field is now a generic glowing-radar motif any voice-assistant dashboard could wear, the chrome is a generic dark dashboard, and the compact type scale is unremarkable. The page is caught between two identities: PRODUCT.md's binding brief (JARVIS-like, strongly graphical, dynamic) and DESIGN.md's authored world (Factory Catalog: matte black, hairline plot, one colour per state, no glow/shadow/gradient, 6rem display). The code follows the brief in its largest area and the catalog in its side columns — and DESIGN.md has not been re-authored to match. The doc/implementation drift is itself the top finding.

As-built type scale vs. authored: h1 36px (doc: 96px), entry number 40px (doc: 80px), body 15px (doc: 18px), labels/captions 11px (doc: 14/12px) — globals.css:67-71.

**Deterministic scan:** `impeccable detect --json apps/web/app/page.tsx` → exit 0, zero findings. The browser overlay found 4 anti-patterns: "tiny body text" (two elements), "body text touching viewport edge, wide letter spacing on body text", and "em-dash overuse (14 em-dashes in body text)". All four are false positives against the authored world: the 15px body and 11px captions are the deliberate compact density the owner asked for (PRODUCT.md: the user "benefits from information density rather than explanation"); the viewport-filling shell with no max-width wrapper is the authored layout rule; the 0.05–0.08em tracking is the Engraved Rule; the em-dash is the documented unmeasured-value convention ("an em dash, never a zero") — the 14 on a fresh page are the unmeasured latency cells.

**Visual overlays:** injection succeeded (mutation preflight passed, detect.js loaded from the live-server, 7 overlay elements rendered, console reported "[impeccable] 4 anti-patterns found"). Overlays were visible in the browser at localhost:3000 during the run; the live-server was stopped and port 8400 verified closed afterwards.

## Overall Impression

The product's bones are excellent — a real interruption model, honest copy, and instrumentation that treats measurement as the authority. What doesn't work: the two documents of record disagree about what the product looks like, the signature field animates at idle encoding nothing, and the first spoken reply can fail silently under the browser's autoplay policy. The single biggest opportunity is to rule on the visual world (JARVIS brief vs. Factory Catalog) and make the code, the doc, and the colour code all tell one story.

## What's Working

1. **The catalog index is a real design language, not a skin.** Zero-padded FAC numbers in tabular Azeret Mono, a permanent one-pixel red strike for interrupted turns with a visually-hidden "interrupted" label for assistive tech (page.tsx:2084-2105, globals.css:740-748), and per-stage latency readouts that show an em-dash rather than a fake zero. Product-true and specific.
2. **Honest copy and honest states.** "Live experimental", "Text input is still available", "the next connection starts a new session", and a language mark derived from the reply's own words that never claims translation (replyLanguage, page.tsx:77-90). PRODUCT.md's principle 2 (never imply a capability the backend lacks) is respected in every string.
3. **Interruption is real and surfaced as a fact.** Stop cancels the request lifecycle, silences playback through a guarded onended (page.tsx:1624-1632), sends INTERRUPT to the gateway, and the struck entry stays struck for the session — the index is a durable record of what was cut, and the instrumentation is always on, never modal.

## Priority Issues

**1. [P1] Doc/implementation drift: the field violates the authored world, and the two documents of record now disagree.**
- **What:** drawJarvisField (page.tsx:2504-2621) draws shadowBlur 8–26 (glow), 26 translucent trail wedges (globalAlpha: 0.055), a full-spectrum rainbow during speaking (hue = (index*3.5 + sweepAngle*24) % 360, page.tsx:2582-2592), thick round-cap bars (≥2px, not 1px hairlines), a constant idle sweep rotation (0.006 rad/frame, page.tsx:1898), and a permanently glowing core orb. DESIGN.md forbids every one of these ("nothing glows, nothing is translucent", "Don't animate the plot from a constant rotation", one colour per state). The as-built type scale is ~40% of the authored display size. The field also contradicts itself within one phase: during speaking the sweep is Bone while the bars are rainbow.
- **Why it matters:** the page no longer has one visual voice; the largest area expresses a generic trope while the side columns express the authored catalog. Every future component decision is provisional until the owner rules on which world is canonical.
- **Fix:** either re-author DESIGN.md around the JARVIS brief (formalizing the new tokens: glow, multi-hue speaking bars, compact scale, Mic switch) or bring the canvas back to the hairline plot (1px ink, phase colour only, rest at baseline when level <= threshold — the decay already exists in foldSpectrum).
- **Suggested command:** $impeccable document

**2. [P1] The first spoken reply can be silently blocked by the browser's autoplay policy; the signature moment fails closed.**
- **What:** the playback AudioContext is created lazily on the first TTS chunk, outside any user gesture (page.tsx:1484-1495, 1563). On a fresh real-browser profile it starts suspended; drainPlaybackQueue then holds the decoded segment (page.tsx:1587-1597) and the only signal is a small red-bordered "PLAY AUDIO RESPONSE" button (page.tsx:2333-2337). Not reproducible headless (the context ran) — verify on a real profile.
- **Why it matters:** this is a voice-first product; a silent first reply with a subtle recovery control reads as "broken" to any first-time user, and the owner's brief makes the spoken voice the product.
- **Fix:** pre-warm the context inside the Send/Hold-to-Talk click handler (a user gesture) — e.g. getPlaybackContext().resume() on submit — or create the context on first pointer interaction anywhere on the page. If blocked, promote the recovery to the notice area with explanatory copy, not a floating button.
- **Suggested command:** $impeccable harden

**3. [P1] Accessibility: push-to-talk is pointer-only, phase state is colour-only, and the transcript floods screen readers.**
- **What:** (a) "Hold to Talk" fires only on onPointerDown/Up/Cancel/Leave (page.tsx:2297-2308) — no click/keydown path, so keyboard and switch-device users cannot start push-to-talk at all. (b) The phase strip is a bare <div> with no text or ARIA (page.tsx:2134-2140) and the canvas is aria-hidden — the product's core state (idle/transcribing/thinking/speaking) is announced nowhere; the latency panel's "TEXT · active" partially conveys it but cannot distinguish thinking from speaking. (c) .messages carries aria-live="polite" (page.tsx:2246), so every LLM delta re-announces the container — a token-by-token flood during streaming.
- **Why it matters:** the mic path is the primary input and the phase is the primary state; both are currently inaccessible to a non-sighted or keyboard-only user of a tool whose purpose is voice.
- **Fix:** add a keyboard path to PTT (keydown/click toggle with aria-pressed); expose the phase as a visually-hidden live-updating text node (or role="status") alongside the strip; move aria-live off the message list — announce only turn start/end and errors.
- **Suggested command:** $impeccable audit

**4. [P2] The One Colour Per State rule is broken in the implementation, and the new Mic switch makes it self-contradictory.**
- **What:** red now means six things (cut strike, Live-on fill, Recording fill, disconnected pill, error text/surface, playback-block button border); blue means four (connected pill, transcribing strip, Mic-on fill, selection background). The new Mic switch fills Signal Blue (globals.css:509-519) while the doc's own rule assigns open-mic states to Cut Red — so two microphone controls sit side by side in two different saturated colours whenever Live is on.
- **Why it matters:** the colour code was the world's primary state language; with 10 meanings across two hues it encodes nothing, and the Mic/Live contradiction is directly confusing about whether the microphone is open.
- **Fix:** assign each token exactly one meaning and update DESIGN.md to match. Concretely: keep red exclusively for cut + error + disconnected; make Mic-on a neutral secondary fill whose state is carried by its label (or formally redefine blue as "microphone" and restripe the connected pill — but then blue can no longer mean transcribing).
- **Suggested command:** $impeccable colorize

**5. [P2] Mobile: the composer is 441px (52% of the viewport) and the "Reconnect now" button is an unstyled native control.**
- **What:** at 390×844 the page is 1822px (2.2 viewports); the composer stacks five full-width buttons (366×32 each) plus the input (globals.css:674-686); the plot eats 699px. Separately, "Reconnect now" lives in .meta with class "secondary", but the only styling rule is .composer button.secondary (globals.css:484) — it never matches. Measured computed style: Arial 13.33px, rgb(239,239,239) fill, 2px outset border, appearance: auto — the sole non-branded control on the page, appearing exactly when the gateway is down.
- **Why it matters:** the recovery affordance at the highest-stakes moment is visual noise; the mobile composer crowds out the field the product is about.
- **Fix:** add a shared button class (or .meta button rule) so Reconnect matches the composer buttons; on mobile, put the five controls in a horizontally scrollable row or 2-column grid, and collapse Live/Hold/Mic into one segmented "input mode" control (also fixes cognitive-load checklist items 3 and 6).
- **Suggested command:** $impeccable adapt

## Persona Red Flags

**Sam (accessibility-dependent):** Hold to Talk is unreachable by keyboard — pointer events only (page.tsx:2297-2308). The phase is colour-only: canvas aria-hidden, strip a bare div, so "is it thinking or speaking?" has no text answer. During streaming, aria-live="polite" on .messages announces every token delta. The Mic switch is done right (role="switch", aria-checked, page.tsx:2312-2320) — which makes the neighbouring pointer-only control look like an oversight rather than a decision.

**Riley (stress tester):** kill the gateway mid-turn and the app behaves well (cancel requests, silence playback, red pill, backoff to 8s, honest copy). But: toggle Live on during an in-flight text turn and startLiveSpeechTurn silently cancels the active request (page.tsx:1242-1251) — the user toggled a mode, not spoke, and the only trace is a struck entry. Also: rapid Send clicks are guarded by canSend, mic-off mid-PTT finalizes the turn — but the Live button's disabled predicate (page.tsx:2284) never considers activeRequestId, the one ungated path to destroying a turn.

**Alex (power user):** the entry readout's timing grid uses proportional digits (computed font-variant-numeric: normal) while the latency panel below uses tabular — the per-turn comparison readout reflows as values update, which the doc itself calls a bug. No keyboard path to Live mode or push-to-talk: every mode change needs the mouse. And the transcript duplicates the index, so scanning a long conversation means reading the same words twice in two type styles.

## Minor Observations

- `caret { color: ... }` (globals.css:131-133) is an invalid selector — a no-op rule; the input caret is default.
- Dead code: LatencyPanel/VadPanel components (page.tsx:2347-2427) are never rendered; the page inlines its own copy of the same markup — a drift risk.
- The canvas resizes only on window.resize (no ResizeObserver); the 800×600 attribute default is transient on first paint.
- DESIGN.md contradicts itself: "Red is never for errors" vs. its own red-grey error styling; Amber is assigned three meanings (thinking, active-entry border, focus outline).
- The header subtitle "barge-in over WebSocket" is engineer-speak in a product whose brief is a JARVIS presence.
- The full session UUID renders in the meta bar — fine for the owner, noisy.
- .composer button transitions border-color/color but not background-color, so the Send button's hover fill flips instantly while its border eases.
- The nav hover rule (.nav button:hover, globals.css:322) out-specifies the later .nav li button rule, so entries get an undocumented background fill on hover alongside the colour change.

## Questions to Consider

- The owner's binding brief is JARVIS-like; DESIGN.md was authored refusing everything that brief asks for. Which document is the world now — the catalog or the field? Until that is ruled, the implementation's split personality (catalog side columns, radar field) is the rational outcome of contradictory direction.
- The field is the largest surface on the page and carries zero information at idle — glow and rotation encode nothing the phase strip and latency panel don't already say better. If its job is emotion, is emotion on a tool whose own principle says "latency is the feature and the measurements are the authority"?
- The transcript and the catalog index render the same conversation twice, in two type systems. If the entry under the FAC number is the answer (the world's own rule), what is the transcript for — and which one is the record when they disagree, e.g. a cut turn whose final text never arrived?
