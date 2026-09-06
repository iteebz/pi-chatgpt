# Architecture

## Problem

pi-chatgpt feels convoluted because it is two things: browser automation of
ChatGPT, and a pi extension. That is not confusion — it is a layer boundary
that was never drawn. Draw it and the convolution disappears.

## The layers

```
  ┌─ pi provider ────┐  ┌─ agent CLI ──────┐  ┌─ consult/channel ┐
  │ pi owns the loop │  │ own loop + tools │  │ no loop, just ask │
  └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘
           └──────────────────── core ─────────────────┘
                    browser.mjs  ask(text) → reply
                    protocol.mjs text ⇄ tool calls
```

**Core (proven).** `Session.ask()` is the entire dependency on ChatGPT: one
multi-turn text channel over CDP. `protocol.mjs` is the tool ABI carried in
prose. Everything above is a consumer.

**Agent CLI (reliable).** Local loop, local tools. This is the Codex-shaped
thing: `pi-chatgpt agent "<task>"`. It exists to prove the core and to run
without pi. Zero protocol violations across 40+ tested turns.

**Consult (reliable).** `pi-chatgpt consult [-f <file>] [-s <n>] "<question>"` — the
agent loop's inverse: ChatGPT is asked, not armed. One turn, no tools, no
protocol; only the core's `ask()`. The value is the context you already own:
a *personalized* temporary chat reads your memory, custom instructions, and
plugins, but writes no memories and leaves no history. So a transcript drop
gets your persona's judgment at zero context pollution.

A **channel** (`open`/`send`/`channels`/`close`) holds that conversation across
CLI invocations. The browser tab is the whole store: state lives in a
`sessionStorage` tag on the page, so there is no daemon, no session file, and
nothing to reconcile — quitting the browser ends every channel. `consult` is
`open` → `send` → `end` collapsed: it closes the tab after each call, so
two concurrent consults never share a conversation and read each other’s
replies as their own turn. Channels keep their tab alive across invocations;
consults discard it.

Temporary chats start **unpersonalized** and the choice locks at the first
message — `Session({ personalize: true })` flips the composer pill during
`open()`. Probed: memory and custom instructions both present in the reply.

**pi provider (broken).** The pi-cc analogue. pi owns the loop, tools, context,
skills, TUI. ChatGPT is only the model. In practice, ChatGPT ignores the
fenced-JSON protocol when it receives pi's large context dump (~7k chars) and
hallucinate tool outputs instead of calling tools. The standalone CLI works
because its prompt is tighter and absolute. This is a prompt engineering gap,
not an architecture gap — see `docs/findings.md` for details.

```
src/pi/index.mjs      registration — provider, models, session lifecycle
src/pi/provider.mjs   the turn — one call in, one reply out, pi's events
src/pi/serialize.mjs  the diff — pi's Context → what the thread has not seen
```

## Why the provider is not just the loop again

| | agent CLI | pi provider |
|---|---|---|
| who plans | ChatGPT | ChatGPT |
| who owns tools | this repo | pi |
| who owns context | the chat thread | pi |
| protocol | ours end to end | pi's tool defs → prose → pi tool_use blocks |

Run it: `pi -e ~/dev/fork/pi-chatgpt/src/pi/index.mjs --model chatgpt-web`.
`PI_CHATGPT_DEBUG=1` logs turn shape; `PI_CHATGPT_TRACE=<file>` writes the
verbatim thread transcript, which is the only place prompt bugs are visible —
pi's TUI shows the parsed result, not what the model actually saw.

Provider contract: `StreamFunction<string, SimpleStreamOptions>` —
`(model, context, options) → AssistantMessageEventStream`, emitting pi's event
vocabulary (`packages/ai/src/types.ts`):

```
start → text_start/text_delta/text_end
      → toolcall_start/toolcall_delta/toolcall_end{toolCall}
      → done{reason: "stop" | "toolUse" | "length"}
```

The thread *is* the session, so the provider is a diff, not a serializer: turn
one carries pi's system prompt and tool schemas, every later turn carries only
the messages the thread has not seen. Assistant messages in the tail are the
thread's own replies coming back — sending them would make the model read its
own words as user input.

That makes drift the central risk. pi rewrites its message array on compaction
and session-tree navigation; a thread that silently kept the old history would
answer from a past that no longer exists. So every message we have represented
is fingerprinted, and when the live array stops extending that prefix — or the
system prompt or tool surface changes — the thread is wrong and gets rebuilt
from scratch in a new chat.

Three events have no honest source and are synthesized:

- `toolcall_delta` — DOM polling yields whole replies, so it fires once with the
  complete arguments rather than not at all.
- `done.reason` — inferred from shape: calls present is `toolUse`, absent is
  `stop`. ChatGPT never reports why it stopped and `length` has no signal, so
  it is never emitted.
- `usage` — estimated at 4 chars per token over everything the thread has
  carried. Zero would be more honest and is worse: pi's auto-compaction would
  never fire and the thread would hit its own invisible ceiling with pi
  believing the context was empty.

## Why not MCP

ChatGPT's MCP connectors are real and **available on this Plus account** —
Settings → Plugins → Developer mode exists, contrary to help-center docs
claiming Business/Enterprise only. A connector needs a public HTTPS endpoint
(stdio and localhost are refused), which a generic tunnel like `cloudflared`
provides without any OpenAI credential. The invariant survives MCP; only
*OpenAI's* tunnel needs a key.

MCP is nonetheless disqualified for the provider, and permanently:

```
pi provider must emit:  toolcall_end{toolCall} → done{reason:"toolUse"}
MCP delivers:           ChatGPT calls the tool itself; we never hold a ToolCall
```

pi executes tools. That requires the call handed back as data. Under MCP the
call never crosses to our side, so the one event the contract depends on can
never fire. This is a type-signature incompatibility, not a maturity gap — it
does not resolve with time.

Inverting it (pi as MCP tool server, ChatGPT as agent) surrenders the loop,
context management, compaction, skills, and TUI. That is not a pi extension.

MCP remains the better mechanism for a *standalone* ChatGPT-controls-my-computer
product, and is the fallback worth building if the prose ABI ever degrades.
Its cost: a tunnel, and widening Settings → Plugins → Permissions past "Allow
low-risk actions", which otherwise demands a click per tool call and kills
unattended loops.

## What ChatGPT web does not give us

The provider must synthesize what a real API hands over:

- **No system prompt slot.** It becomes turn one of the thread.
- **No native tool calling.** Fenced JSON is the ABI. Angle-bracket tags do not
  survive markdown rendering — and neither do the fences themselves: a fenced
  block renders to `<pre><code>`, where `innerText` returns `JSON\n{...}` with
  the markers gone and the language demoted to a UI label. `browser.mjs`
  reconstructs the fences from the code elements. The CLI never noticed because
  its parser accepts bare braces; the provider cannot, because prose and calls
  share a turn there.
- **No obedience by default.** pi's system prompt assumes native tools and says
  nothing about how they arrive, so ChatGPT answers from its own prior — "I
  can't access that path," then "the tool isn't available in this chat," then a
  failed attempt through its own code interpreter. Three refusals, three prompt
  fixes: frame the machine as real before pi's prompt, forbid its own tools
  explicitly, and state that writing the block *is* the action rather than
  asking it to invoke anything.
- **No token accounting.** Usage is estimated from characters. Context ceiling
  is the thread's, unknown and smaller than the API's.
- **No parallelism.** One browser tab, one reply at a time; every call queues.
- **No prompt caching, and no need for one.** Free inference removes the
  incentive the cache invariant protects.
- **Latency is the cost.** 4–8s per turn measured, vs sub-second API TTFT.
  Unlimited but slow — the trade the whole project is buying.

## Measured

Agent CLI, real tasks, zero API spend:

| task | turns | per-turn | model |
|------|-------|----------|-------|
| write + run fizzbuzz, verify output | 2 | 5s | GPT-4o mini |
| explore repo, 4 distinct tools, write summary, verify | 5 | 4–7s | GPT-4o mini |
| build TODO CLI, exercise add/list/done, verify state file | 8 | 4–8s | GPT-4o mini |
| sieve of Eratosthenes, run, verify with assert | 3 | 5s | Sol (High) |

No protocol violations across 40+ turns. High thinking with Sol produces
better tool discipline and unprompted verification.

Pi provider: ChatGPT replies with hallucinated outputs instead of tool calls
on every attempt. The model sees the user request at the end of a large
context dump and answers it directly. Not measured further — the bug is
qualitative, not statistical.
