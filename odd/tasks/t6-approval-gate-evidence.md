# T5/T6 evidence — the tool channel and the approval gate

Evidence for tasks **T5** (the agent's channel to the browser) and **T6** (tool
activity and the approval gate in the UI) of `open-voice-agentic-actions`.
Captured 2026-10-06 with `TOOLS_ENABLED=true`.

## What was built

- **The channel** — a second WebSocket, `ws://localhost:8788`, owned by the
  agent. It carries tool activity out and approval decisions in. A separate
  listener rather than a route on the gateway's, because the vendored gateway's
  WebSocket server accepts every upgrade and carving a path out of it would mean
  fighting it.
- **The gate** — a panel above the composer showing the **exact** action, with
  Approve and Deny. Deny holds focus, so a stray Enter picks the safe answer.
- **`TOOLS_APPROVAL`** — `sandbox` (default) runs anything confined to the
  sandbox on its own and gates only what leaves it; `all` gates every call. The
  second mode is not decoration: without it there is nothing to gate until host
  escalation exists, and a gate with no trigger is unreachable UI. It is also
  the pattern the prior art uses (sandbox auto-allow vs regular permissions).

## Deny, end to end

Instruction: *"create saludo.js … run it with node … tell me what it printed"*.
One gate appeared and was denied.

```
GATES SEEN: 1
  gate 1: {
    "kind": "write_file",
    "path": "saludo.js",
    "content": "console.log('hola desde el sandbox');"
  }
ANSWER: Necesito tu permiso para crear el archivo saludo.js y ejecutarlo.
ACTIVITY LOG:
  GATE  approval required · write_file
  GATE  denied · write_file
  TOOL  write_file · denied
```

Checked outside the agent, because "the model said it didn't" is not evidence:

```
$ docker compose exec -T sandbox ls /workspace/saludo.js
ls: cannot access '/workspace/saludo.js': No such file or directory
```

Nothing ran. The gate showed the whole action, not a summary of it.

## Approve, end to end

Same instruction, both gates approved. **Two** gates, because the task needs two
tool calls and every call is gated in this mode.

```
GATES SEEN: 2
  gate 1: { "kind": "write_file", "path": "saludo.js", "content": "…" }
  gate 2: node saludo.js
ANSWER: El programa imprimió: hola desde el sandbox.
ACTIVITY LOG:
  GATE  approval required · write_file
  GATE  approved · write_file
  TOOL  write_file · saludo.js · 37 chars
  TOOL  write_file · ok · 88 ms
  GATE  approval required · run_command
  GATE  approved · run_command
  TOOL  run_command · node saludo.js
  TOOL  run_command · ok · 256 ms
```

And again, verified from outside:

```
$ docker compose exec -T sandbox node /workspace/saludo.js
hola desde el sandbox
```

Both paths also leave an audit line per call (`tool.audit` in the agent log), and
zero console errors in the browser in both runs.

## What the tests pin (not just the happy path)

`tool-channel.test.ts` — a connection from a foreign origin is refused; with no
allowed origin configured **every** connection is refused; an unanswered approval
is denied when it expires; an approval is denied when the client disconnects;
with nobody connected it is denied immediately rather than after a wait; a
malformed or misaddressed decision never settles a gate.

`llm.test.ts` — `approval=all` raises a gate and runs the call once approved; a
denied call never reaches the sandbox and comes back to the model as `denied`;
call and result notices are emitted so the UI can follow along.

## The finding worth keeping

The first attempt at this acceptance failed with *"no button matched deny"*. The
cause was not the test: the gate panel was styled `.gate`, and the activity log
row for a gate event is `<li class="log-row gate">`. **The panel rule was
painting every gate line in the log** — padding, border and panel background on
a one-line list item. Renamed to `.gate-panel`. A class name is a namespace, and
this one was taken.

## Honest scope — what this pass did NOT exercise

- The gate was exercised through its `all` mode. In the default `sandbox` mode
  it is armed but nothing triggers it yet, because no tool leaves the sandbox
  until host escalation (T7) exists.
- No voice interaction: the gate is screen-only by design, and "the voice cannot
  approve" was not re-verified here (it is a property of there being no wire
  path from audio to a decision, which the tests cover structurally).
- One browser, one client. Two tabs both connected would each see the gate and
  whichever answered first would settle it; that was not tested.
- Reconnection: the client retries every 3s, but a channel that drops *while* a
  gate is pending was not exercised (the server denies on disconnect, which is
  unit-tested).
