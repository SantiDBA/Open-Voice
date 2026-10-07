# T4 evidence — the tool loop, running for real

Evidence for task **T4** of `open-voice-agentic-actions`: the agent stopped being
a thing that only talks. Captured 2026-10-06 against the running stack, with
`TOOLS_ENABLED=true`.

## What was asked

Give the agent a tool loop without touching the vendored gateway, so that an
instruction like "create a script and run it" actually creates and runs it.
Success is not the agent *saying* it ran something — it is the file existing and
the program's output being real.

## How it was verified

Playwright drove the real browser UI at `localhost:3000` (the same path a person
uses: type, Send, watch the reply). The agent's claim was then checked
**independently**, by looking at the sandbox's filesystem and the audit trail,
because a model saying it ran something is not evidence that it did.

Instruction sent:

> Crea el archivo saludo.js en el workspace que imprima exactamente 'hola desde
> el sandbox', ejecutalo con node, y decime que imprimio.

Answer spoken back: *"Ejecuté el archivo. Imprimió: hola desde el sandbox."* —
with zero console errors in the browser.

### The agent's claim, checked outside the agent

```
$ docker compose exec -T sandbox node /workspace/saludo.js
hola desde el sandbox
```

And the file on disk:

```
-rw-r--r-- 1 node node 37 Oct  6 18:12 saludo.js
console.log('hola desde el sandbox');
```

### The audit trail of that turn

```
tool.audit tool=write_file  action=write_file
  arguments={"kind":"write_file","path":"saludo.js","content":"console.log('hola desde el sandbox');"}
  outcome=ok durationMs=17

tool.audit tool=run_command action=exec
  arguments={"kind":"exec","command":"node saludo.js"}
  outcome=ok exitCode=0 durationMs=61
```

Two tool calls, in the order the task needs, both confined to the sandbox.

## The finding worth keeping

The **first** run, before a fix, produced three calls:

```
tool.audit tool=write_file  outcome=ok
tool.audit tool=run_command outcome=refused  detail="\"cwd\" must not be empty."
tool.audit tool=run_command outcome=ok       arguments={"command":"node saludo.js","cwd":"."}
```

The model sent `"cwd": ""` meaning "use the default". The policy refused it —
technically defensible — and the loop **recovered by itself**: the refusal came
back as a tool result, the model corrected the argument, and the turn finished
correctly. That recovery is the design working, but the refusal bought a wasted
model round-trip, and latency is a first-class concern here.

An empty optional string now means "not given" rather than an error. Re-run: two
calls, no refusal, same file, same output. The test suite pins the behaviour
(`policy.test.ts`, "treats an empty optional string as not given").

## Honest scope — what this pass did NOT exercise

- Only text turns. The voice path through a tool turn (speak the instruction,
  hear the answer) was not exercised with a microphone; barge-in during a tool
  turn is covered by a unit test, not by a real interruption.
- Tool activity is **not visible in the UI yet**. The audit goes to the agent's
  log (`docker compose logs agent | grep tool.audit`); showing it in the activity
  panel, and the approval gate, are T5 and T6.
- No gate exists yet, which is fine only because every current tool is confined
  to the sandbox. Host escalation (T7) must not land before the gate.
- `auto/chat` routes to a different upstream model per request; this run landed
  on one that supports tools. Pinning `LLM_MODEL` remains an open risk from T0.
- Output caps, the iteration limit and cancellation are covered by unit tests
  with fake servers, not by a real runaway command.
