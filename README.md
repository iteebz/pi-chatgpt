# pi-chatgpt

ChatGPT Plus as a coding agent on your machine. Your subscription pays for the
inference — no API key, no credits, no per-token bill.

```
task ──▶ agent loop (local) ──▶ browser ──▶ ChatGPT Plus
             ▲                                  │
             └──── tool results ◀── shell/file/grep/git
```

ChatGPT decides. Local code executes. The browser is just the wire.

## Quick start

```bash
npm install

# Chromium with remote debugging, logged into ChatGPT Plus
open -a Arc --args --remote-debugging-port=9222
curl -s http://127.0.0.1:9222/json/version   # verify

node bin/cli.mjs agent "write fizzbuzz.py in /tmp, run it, confirm the output"
```

The loop prints each tool call as it happens and exits with a JSON trace of
every step, argument, and result.

## Tools

| Tool | Description |
|------|-------------|
| `shell` | Execute a command, get stdout/stderr/exit code |
| `file_read` | Read a file or list a directory |
| `file_write` | Write a file (creates parents) |
| `grep` | Recursive search with file/line results |
| `git` | Git operations (status, diff, log, commit, etc.) |

The protocol is a fenced JSON block per turn — `{"tool": ..., "args": ...}` in,
tool result back, `{"done": "..."}` to finish. Angle-bracket tags do not
survive markdown rendering; fences do.

## The invariant

**Free ChatGPT only.** No OpenAI API key, no Codex quota, no metered path —
ever. Traffic is your logged-in browser session on the normal chat endpoint,
indistinguishable from you typing. `tests/invariant.test.mjs` fails the build if
a credential, a paid endpoint, or a tunnel dependency enters the source.

The one dependency is `playwright-core`, and it only attaches to a browser you
already have open.

## Tests

```bash
npm test                       # 30 unit tests, no browser needed
node bin/cli.mjs agent "..."   # live probe against ChatGPT Plus
```

## Prior art

Two projects sit adjacent. Neither does what this does.

| | how ChatGPT gets tools | who drives | needs | core LOC |
|---|---|---|---|---|
| **pi-chatgpt** | fenced JSON in the chat | ChatGPT drives your machine | a logged-in browser | ~270 |
| [codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) | native MCP over OpenAI tunnel | ChatGPT drives Codex's harness | tunnel binary + runtime key + dev mode | ~36k |
| [agentify-sh/desktop](https://github.com/agentify-sh/desktop) | n/a — ChatGPT is asked, not armed | your agent queries ChatGPT | Electron control center | ~1.9k |

**codex-chatgpt-web** is the closest ancestor and the strongest project of the
three: real compaction, retries, five browser tabs, cross-platform launcher. It
reaches ChatGPT the official way — a tunnel and an MCP connector — and spends
~3.6k lines on a browser worker to make the web UI behave like the Responses
API. The cost is the setup: a pinned `tunnel-client` binary, a runtime API key,
Developer Mode, a connector. We took the unofficial way and needed none of it.

**agentify-desktop** points the other direction. Its MCP tools let *your* agent
ask ChatGPT a question ("get a second opinion", "read this tab"). ChatGPT never
touches your filesystem. Useful, but not an agent loop.

The bet here: ChatGPT is smart enough that the tool ABI can be prose. That
deletes the tunnel, the connector, the API key, the daemon, and the Responses
translation layer — everything between the model and the shell. `Session.ask()`
is the entire dependency on ChatGPT, so DOM drift can only break transport,
never behavior. The official route stays closed by policy: it needs a key.

## License

MIT
