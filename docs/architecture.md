# Architecture

## Problem

pi-chatgpt feels convoluted because it is two things: browser automation of
ChatGPT, and a pi extension. That is not confusion — it is a layer boundary
that was never drawn. Draw it and the convolution disappears.

## The layers

```
        ┌─ pi provider (premier surface) ──┐   ┌─ agent CLI (standalone) ─┐
        │  pi owns loop, tools, context    │   │  own loop, own tools     │
        └───────────────┬──────────────────┘   └────────────┬─────────────┘
                        │                                   │
                        └─────────── core ──────────────────┘
                             browser.mjs  ask(text) → reply
                             protocol.mjs text ⇄ tool calls
```

**Core (proven).** `Session.ask()` is the entire dependency on ChatGPT: one
multi-turn text channel over CDP. `protocol.mjs` is the tool ABI carried in
prose. Everything above is a consumer.

**Agent CLI (shipped).** Local loop, local tools. This is the Codex-shaped
thing: `pi-chatgpt agent "<task>"`. It exists to prove the core and to run
without pi.

**pi provider (target).** The pi-cc analogue. pi owns the loop, tools, context,
skills, TUI. ChatGPT is only the model. This is the premier surface because
`dev/fork/pi` is the premier harness — every other capability compounds there.

## Why the provider is not just the loop again

| | agent CLI | pi provider |
|---|---|---|
| who plans | ChatGPT | ChatGPT |
| who owns tools | this repo | pi |
| who owns context | the chat thread | pi |
| protocol | ours end to end | pi's tool defs → prose → pi tool_use blocks |

Provider contract: `StreamFunction<string, SimpleStreamOptions>` —
`(model, context, options) → AssistantMessageEventStream`. Three jobs:

1. **Serialize** pi's system prompt + tool schemas into the first turn of a
   chat thread; serialize each later turn as only the new message. The thread
   *is* the session — do not resend history, the browser already holds it.
2. **Parse** the reply into assistant events: text, then `tool_use` blocks from
   fenced JSON (`protocol.mjs` already does this half).
3. **Map** a chat thread to a pi session, like pi-cc maps a CC session UUID.
   New thread on session start, reuse across turns, rebuild on drift.

## What ChatGPT web does not give us

The provider must synthesize what a real API hands over:

- **No system prompt slot.** It becomes turn one of the thread.
- **No native tool calling.** Fenced JSON is the ABI. Angle-bracket tags do not
  survive markdown rendering.
- **No token accounting.** Usage numbers are fabricated or zero; pi's
  auto-compaction cannot rely on them. Context ceiling is the thread's, unknown
  and smaller than the API's.
- **No prompt caching, and no need for one.** Free inference removes the
  incentive the cache invariant protects.
- **Latency is the cost.** 4–8s per turn measured, vs sub-second API TTFT.
  Unlimited but slow — the trade the whole project is buying.

## Measured

Agent CLI, real tasks, zero API spend:

| task | turns | per-turn |
|------|-------|----------|
| write + run fizzbuzz, verify output | 2 | 5s |
| explore repo, 4 distinct tools, write summary, verify | 5 | 4–7s |
| build TODO CLI, exercise add/list/done, verify state file | 8 | 4–8s |

No prose derailment, no protocol violations, no reprompts across 15 turns.
