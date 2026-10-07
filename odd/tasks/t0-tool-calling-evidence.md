# T0 evidence — tool calling through OmniRoute

Evidence for task **T0** of `open-voice-agentic-actions` (the blocking spike; nothing in Phase 0
gets built until this passes). Captured 2026-10-06 against the running stack, from the host.

## What was asked

Confirm that the LLM the agent actually reaches — OmniRoute at `http://127.0.0.1:20128/v1` with
`model: auto/chat` — supports OpenAI-style **tool calling**, **including in streaming mode**, and
that a **tool result fed back** produces a final answer. The repo documents the opposite as a
hard limitation ("The upstream request body is fixed at `{ model, messages, stream }`. … no tools"),
so if this had failed the whole architecture would have needed a different mechanism.

## Result: PASS on all three

The probes were raw `curl` calls. No code was written.

### A — `tools`, non-streaming

Request: one `read_file` tool, one user turn asking the model to call it.

Observed response (trimmed):

```json
{
  "model": "openai/gpt-oss-120b",
  "choices": [{
    "finish_reason": "tool_calls",
    "message": {
      "role": "assistant",
      "reasoning": "The user asks to read file /tmp/demo.txt using read_file tool. …",
      "tool_calls": [{
        "id": "fc_06448780-5533-47e6-93d3-5eb295f96609",
        "type": "function",
        "function": { "name": "read_file", "arguments": "{\"path\":\"/tmp/demo.txt\"}" }
      }]
    }
  }],
  "usage": { "prompt_tokens": 150, "completion_tokens": 54, "total_tokens": 204 }
}
```

- `finish_reason` is `tool_calls`; the call carries an `id`, a `name` and JSON `arguments`.
- The router resolved `auto/chat` → **`openai/gpt-oss-120b`**.

### B — `tools`, streaming

Request: `stream: true`, one `list_dir` tool. Captured to `/tmp/probeB.sse`.

```
chunks totales:          22
chunks con reasoning:    17
chunks con tool_calls:    2
```

The tool call arrives as a delta, in the same shape OpenAI uses:

```json
"tool_calls":[{"id":"fc_ae687f6f-…","type":"function",
  "function":{"name":"list_dir","arguments":"{\"path\":\"/tmp\"}"},"index":0}]
```

and the stream closes with:

```
"finish_reason":"tool_calls"
```

So the loop can read `delta.tool_calls` incrementally and stop on `finish_reason`. Arguments in
this sample arrived whole, but the implementation must still concatenate by `index` (the
OpenAI-compatible contract allows fragmentation).

### C — full round-trip

Request: user turn → assistant `tool_calls` → `role:"tool"` result with `tool_call_id`, all in one
streamed request.

Final streamed text:

```
En el directorio **/tmp** hay **3** entradas.
```

with `"finish_reason":"stop"`. The model used the tool result and answered.

## Two discoveries worth acting on

1. **`auto/chat` routes to a different upstream model per request.** This probe landed on
   `openai/gpt-oss-120b`; another day it may land on a model without tool support. A tool loop
   must not depend on the router's mood: **pin `LLM_MODEL` to a tool-capable id**, or probe for
   tool support at startup and refuse to enable tools when it is absent. This is a new, concrete
   risk that was not visible before the probe.
2. **The model streams its reasoning.** `delta.reasoning` arrives with `channel: "analysis"`,
   separately from `delta.content` (29 of 47 chunks in probe C). Combined with the activity log
   already shipped, this means the "Thinking" panel can show the model's *real* reasoning stream
   instead of a spinner — directly on-brief for the owner's "quiero ver lo que hace".

## A caveat to carry into the loop

Probe C's final text came back with markdown (`**/tmp**`). The agent persona already forbids
markdown because the output is spoken, but a tool-using model reaches for it more readily. The
tool loop must keep the no-markdown rule on the final answer (the existing persona already states
it; the loop must not bypass the persona).

## Honest scope — what this pass did NOT exercise

- Only one router (`OmniRoute`) and one resolved upstream model (`openai/gpt-oss-120b`).
- Only single, sequential tool calls. **Parallel tool calls were not tested**, and neither were
  malformed arguments, unknown tool names, or a model that ignores the tools entirely.
- No latency measured; the loop's added round-trips are an open item for Phase 0 verification.
- Nothing about the sandbox, the loop, or the UI was exercised — this is a provider capability
  probe only.
