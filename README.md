# pi-chatgpt

ChatGPT as a coding agent on your machine. Your subscription pays for the
inference — no API key, no credits, no per-token bill.

```
task ──▶ agent loop (local) ──▶ browser ──▶ ChatGPT
             ▲                                  │
             └──── tool results ◀── shell/file/grep/git
```

ChatGPT decides. Local code executes. The browser is just the wire.

## Quick start

```bash
npm install
node bin/cli.mjs agent "write fizzbuzz.py in /tmp, run it, confirm the output"
```

That's it. The browser launches automatically — Arc if running (inherits your
login session), otherwise Chrome off-screen with a persistent profile.

Environment variables for control:

| var | default | purpose |
|-----|---------|---------|
| `PI_CHATGPT_THINKING` | `High` | Thinking slider: `Instant`, `Medium`, `High` |
| `PI_CHATGPT_CDP` | `http://127.0.0.1:9222` | CDP endpoint to connect to |
| `PI_CHATGPT_CDP_PORT` | `9222` | CDP port when auto-launching |
| `PI_CHATGPT_PROFILE` | `~/.pi-chatgpt/chrome-profile` | Chrome profile for auto-launch |
| `PI_CHATGPT_DEBUG` | unset | Log turn shape to stderr |
| `PI_CHATGPT_TRACE` | unset | Write verbatim thread transcript to file |

## Tools

| Tool | Description |
|------|-------------|
| `shell` | Execute a command, get stdout/stderr/exit code |
| `file_read` | Read a file or list a directory |
| `file_write` | Write a file (creates parents) |
| `grep` | Recursive search with file/line results |
| `git` | Git operations (status, diff, log, commit, etc.) |

The protocol is a fenced JSON block per turn — `{"tool": ..., "args": ...}` in,
tool result back, `{"done": "..."}` to finish.

## Browser strategy

1. **Attach to running Arc** — `open -na Arc --args --remote-debugging-port=9222`.
   Inherits your logged-in ChatGPT session, cookies, and model access (Sol, etc).
2. **Attach to running Chrome** — same, for Google Chrome.
3. **Launch Chrome off-screen** — persistent profile at `~/.pi-chatgpt/chrome-profile`,
   window at `(-9999, -9999)`. No login = GPT-4o mini. Cloudflare blocks
   `--headless`, so this is a real browser you never see.

## What works and what doesn't

**Standalone CLI — reliable.** The agent loop (`bin/cli.mjs agent`) follows the
fenced-JSON protocol consistently. Tested across 40+ turns with zero protocol
violations.

**Pi provider — unreliable.** When registered as a pi extension, ChatGPT
receives pi's full context (~7k chars of system prompt, tool definitions, and
protocol specification) as a single turn. The model reads the user's request
and answers it directly instead of emitting tool calls — it hallucinates
outputs rather than following the protocol. The standalone CLI works because
its prompt is tighter ("every reply is exactly one fenced json block and
nothing else"). This is a prompt engineering problem, not an architecture
problem, but it's unsolved.

## The invariant

**Free ChatGPT only.** No OpenAI API key, no Codex quota, no metered path —
ever. `tests/invariant.test.mjs` fails the build if a credential, a paid
endpoint, or a tunnel dependency enters the source.

## Tests

```bash
npm test                       # 43 unit tests, no browser needed
node bin/cli.mjs agent "..."   # live probe against ChatGPT
```

## Prior art

| | how ChatGPT gets tools | who drives | needs | core LOC |
|---|---|---|---|---|
| **pi-chatgpt** | fenced JSON in the chat | ChatGPT drives your machine | a Chromium browser | ~350 |
| [codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) | native MCP over OpenAI tunnel | ChatGPT drives Codex's harness | tunnel binary + runtime key + dev mode | ~36k |
| [agentify-sh/desktop](https://github.com/agentify-sh/desktop) | n/a — ChatGPT is asked, not armed | your agent queries ChatGPT | Electron control center | ~1.9k |

The bet: ChatGPT is smart enough that the tool ABI can be prose. That deletes
the tunnel, the connector, the API key, the daemon, and the Responses
translation layer. `Session.ask()` is the entire dependency on ChatGPT, so DOM
drift can only break transport, never behavior.

## Status

**Prototype — parked.** The standalone agent loop works. The pi provider path
needs prompt work before it's reliable. ToS risk is real (automated access to
ChatGPT web), so this lives as a proof of concept, not a production surface.

## License

MIT
