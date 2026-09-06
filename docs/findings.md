# Findings

What we learned building a local coding agent backed by ChatGPT's browser
session instead of an API.

## The goal

Unlimited GPT-5.6 Sol (or whatever model ChatGPT serves) driving a coding
agent on the local machine. Plus subscription pays for inference — zero API
spend, zero credits drawn.

## What works

### Standalone agent loop — reliable

`node bin/cli.mjs agent "<task>"` — ChatGPT drives real tools on this machine.

| probe | turns | per-turn | result |
|-------|-------|----------|--------|
| write fizzbuzz.py, run, verify | 2 | 5s | ✅ |
| explore repo, 4 tools, write summary | 5 | 4–7s | ✅ |
| build TODO CLI, exercise add/list/done | 8 | 4–8s | ✅ |
| sieve of Eratosthenes, run, verify with assert | 3 | 5s | ✅ |

Zero protocol violations across 40+ turns. The tight prompt ("every reply is
exactly one fenced json block and nothing else") is the reason — it leaves no
room for the model to "help" by skipping tool calls.

### Browser auto-launch

Three-tier fallback, fully automatic:
1. CDP already running → attach
2. Arc (or Chrome) running → quit gracefully via AppleScript (pkill fallback if a modal blocks) → relaunch with `--remote-debugging-port=9222` — warns on stderr; open channels are lost
3. Nothing → launch Chrome off-screen with persistent profile

Bring-up is serialized across concurrent processes via a lockdir at
`~/.pi-chatgpt/cdp.lock`. A process that loses the race waits for CDP to come
up rather than triggering a second restart.

macOS only applies `--args` at process start, so a browser already running
without the flag has to be quit and relaunched — hence the restart rather than
a simple `open -na` call against an already-running instance (which is a
silent no-op).

Arc attachment is the best path: inherits logged-in session, model access
(Sol), and chat history. Chrome off-screen gets GPT-4o mini (no login).

### Login detection and personalization

The composer appearing is the proof of a logged-in, challenge-free session.
If it never appears, the error now names the cause:
- URL matches `/auth|login/` → `ChatGPT is not logged in (...). Sign in to chatgpt.com in your browser.`
- Otherwise → `ChatGPT composer never appeared at ... — login wall or bot challenge.`

Personalized temporary chats read memory and custom instructions. The pill that
locks the choice is only present before the first message; if it stays visible
after the click attempt (e.g. the menu didn’t open), a warning is written to
stderr rather than silently losing memory for the turn.

### Thinking slider control

ChatGPT's UI exposes a 3-position thinking slider: Instant / Medium / High.
Controllable via `PI_CHATGPT_THINKING` env var. The slider is a Radix UI
component — click the pill button to open, focus the slider control element,
ArrowRight/ArrowLeft to navigate, Escape to dismiss. Direct click on model
radio items fails (animation overlay intercepts pointer events).

High thinking produces noticeably better tool-call discipline and verification
behavior (wrote a separate assert-based verification script unprompted).

### DOM fence reconstruction

ChatGPT renders ` ```json {...}``` ` as `<pre><code>` — fences disappear from
`innerText`, language survives only as a CSS class. `browser.mjs` reconstructs
fences from code elements. Without this, the parser that distinguishes tool
calls from quoted JSON in prose would break.

## What doesn't work

### Pi provider — model ignores protocol

When registered as a pi extension (`pi --provider chatgpt-web`), ChatGPT
receives pi's full context (~7k chars) as a single turn: system prompt, tool
definitions, protocol specification, and user message. The model reads the
user request at the end and **answers it directly** — it hallucinates tool
outputs rather than emitting fenced JSON tool calls.

Attempted fixes that didn't help:
- Adding "CRITICAL: You MUST use the fenced json tool-call format" to framing
- Explicit instruction not to simulate or predict tool output
- Setting thinking to High

The standalone CLI works because its prompt is shorter and absolute: "every
reply is exactly one fenced json block and nothing else. no prose outside it."
Pi's prompt allows prose alongside tool calls, and ChatGPT exploits that
opening to skip the tools entirely.

This is a prompt engineering problem. Possible fixes not yet tried:
- Split preamble into turn 1, wait for ack, send task as turn 2
- Inject a fake first tool-call exchange to demonstrate the protocol
- Shorten pi's system prompt for the chatgpt-web provider

### Headless Chrome

Cloudflare detects `HeadlessChrome` in the User-Agent and serves a captcha
wall. `--headless=new` doesn't help. Must be a real browser process.

### Network interception

SSE body truncated over CDP. The delta encoding v1 parser works but
`response.text()` returns before the stream finishes. DOM polling is the
reliable path.

## Model access without login

ChatGPT serves GPT-4o mini to anonymous users. The composer loads, the agent
loop runs, tools execute. Weaker model but functional for simple tasks.

With a Plus login (via Arc session inheritance), you get access to Sol and the
thinking slider. The Plus account is the real asset here — and the real risk,
since automated access violates ToS.

## Risk assessment

- **Detection:** Easy. Automated typing patterns, CDP attachment, temp chats,
  no mouse movement, instant paste of multi-KB prompts.
- **Enforcement:** Account ban. Plus subscription and chat history lost.
- **Likelihood:** Low today. codex-chatgpt-web exists and seems unflagged.
  Increases if these tools get popular.
- **Mitigation:** Throwaway account for testing. Don't run against a primary
  account with history you care about.

## Prior art comparison

| | pi-chatgpt | codex-chatgpt-web | agentify-desktop |
|---|---|---|---|
| tool delivery | fenced JSON in prose | native MCP over tunnel | n/a (query only) |
| concurrency | 1 tab, serial | 5 tabs, parallel | parallel tabs |
| session | temp chat, serial reuse | temp chat per task | stable tab keys |
| setup | zero | tunnel + API key + dev mode | Electron install |
| LOC | ~350 | ~36k | ~1.9k |

codex-chatgpt-web solves a harder problem (Codex compatibility) and is the
stronger project. pi-chatgpt is simpler because the standalone CLI owns the
entire loop, and the pi provider path (which would need codex-level complexity
to be reliable) doesn't work yet.

## Architecture

```
      ┌─ pi provider (broken) ────────┐   ┌─ agent CLI (works) ──────┐
      │  pi owns loop, tools, context │   │  own loop, own tools     │
      └───────────────┬───────────────┘   └────────────┬─────────────┘
                      │                                │
                      └─────────── core ───────────────┘
                           browser.mjs  ask(text) → reply
                           protocol.mjs text ⇄ tool calls
```

The core is proven and clean. `Session.ask()` is the entire dependency on
ChatGPT. The standalone CLI consumer is reliable. The pi provider consumer
needs prompt work.

## Reference repos

| repo | useful for |
|------|------------|
| pi-cc (`~/dev/fork/pi-cc`) | pi extension architecture, provider registration |
| codex-chatgpt-web | ChatGPT DOM interaction, tab pooling, MCP bridge |
| agentify-desktop | multi-vendor browser automation |
