# pi-chatgpt

Local MCP server that gives ChatGPT web Codex-like control of your computer.

No browser automation. No DOM scraping. ChatGPT is already an MCP client —
this just gives it tools.

```
ChatGPT web ──MCP connector──▶ OpenAI tunnel ──▶ pi-chatgpt (local)
                                                    ├── shell
                                                    ├── file_read
                                                    └── file_write
```

## Quick start

```bash
npm install
node bin/cli.mjs test     # verify tools work
node src/server.mjs       # start MCP server on stdio
```

## Connect to ChatGPT

1. Create a [Tunnel](https://platform.openai.com/tunnels) and API key on the
   same OpenAI account you'll use in ChatGPT web.

2. Run the tunnel, pointing at this server:

   ```bash
   npx @openai/tunnel-client --tunnel-id YOUR_TUNNEL_ID --api-key YOUR_KEY \
     -- node src/server.mjs
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

## Tests

```bash
npm test
```

## Prior art

This project takes the opposite approach from browser-automation tools:

- **[codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web)** —
  Playwright drives ChatGPT's web UI, translates to Codex's Responses API.
  Complex (~38k LOC), fragile to DOM changes. Its "full harness" MCP mode
  (ChatGPT calling back to Codex tools) is the closest ancestor to what
  pi-chatgpt does, but codex-chatgpt-web also automates the browser side.

- **[agentify-sh/desktop](https://github.com/agentify-sh/desktop)** —
  Electron app exposing MCP tools that type into ChatGPT/Claude/etc web UIs.
  Same browser automation approach, wrapped in MCP. Generic across providers
  but fundamentally dependent on DOM selectors.

- **Codex itself** — the tool contract (shell, file read/write) that pi-chatgpt
  reimplements as a standalone MCP server.

pi-chatgpt skips the browser layer entirely. ChatGPT natively supports MCP
connectors (Plus/Pro/Business/Enterprise). The OpenAI tunnel makes a local
stdio MCP server reachable. No Playwright, no Electron, no selector
maintenance.

## License

MIT
