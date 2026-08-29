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

## Alternate path: native MCP connector

The same tools are exposed as an MCP server (`node src/server.mjs`), reachable
from ChatGPT web through an OpenAI tunnel. This inverts ownership — ChatGPT
runs the loop natively — at the cost of a tunnel ID, a runtime API key, and a
daemon.

## Connect to ChatGPT

1. Create a [Tunnel](https://platform.openai.com/tunnels) and API key on the
   same OpenAI account you'll use in ChatGPT web.

2. Run the tunnel:

   ```bash
   brew install openai/tools/tunnel-client

   export CONTROL_PLANE_TUNNEL_ID='tunnel_...'
   export CONTROL_PLANE_API_KEY='your-runtime-key'

   tunnel-client init --sample sample_mcp_stdio_local --profile pi-chatgpt \
     --tunnel-id $CONTROL_PLANE_TUNNEL_ID \
     --mcp-command "node $(pwd)/src/server.mjs"

   tunnel-client doctor --profile pi-chatgpt --explain
   tunnel-client run --profile pi-chatgpt
   ```

3. In ChatGPT web:
   - Settings → Developer Mode → On
   - Create a new connector via Tunnel
   - Select your tunnel, set auth to None
   - Name it `pi-chatgpt`
   - Permissions → Allow all actions

4. In any ChatGPT conversation, mention `@pi-chatgpt` or let it discover the
   tools. ChatGPT can now run shell commands, read files, and write files on
   your machine.

## Tools

| Tool | Description |
|------|-------------|
| `shell` | Execute a command, get stdout/stderr/exit code |
| `file_read` | Read a file or list a directory |
| `file_write` | Write a file (creates parents) |
| `grep` | Recursive search with file/line results |
| `git` | Git operations (status, diff, log, commit, etc.) |

The server also exposes an `environment` resource with OS, shell, cwd,
git branch, and project markers — so ChatGPT knows what it's working on.

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
never behavior. The MCP server path remains for anyone who prefers the official
route.

## License

MIT
