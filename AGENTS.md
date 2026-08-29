# pi-chatgpt

## problem

ChatGPT Plus gives unlimited GPT-5.6 Sol via the conversation interface.
The Codex API and OpenAI API both meter usage (credits or tokens).
No existing tool turns the unlimited conversation path into a coding agent
that can act on the local machine.

## goal

ChatGPT Sol as a coding agent on this computer. Unlimited inference via
Plus subscription. Zero API spend.

## proven

- **The agent loop works.** `node bin/cli.mjs agent "<task>"` — ChatGPT Plus
  plans, local code executes, results paste back. Probed end to end: wrote and
  ran a script; explored the repo across 4 tools and wrote a verified summary.
- Browser automation via CDP: Playwright connects to Arc, reuses the logged-in
  ChatGPT Plus session, sends prompts, polls DOM for responses.
- MCP server: 5 tools (shell, file_read, file_write, grep, git). 30 tests.

## architecture options

See `docs/findings.md` for full analysis. Three paths:

| option | who owns the loop | transport | status |
|--------|-------------------|-----------|--------|
| A. OpenAI tunnel | ChatGPT | native MCP via tunnel-client | needs runtime API key |
| B. Browser agent loop | local code | browser DOM | **shipped, works** |
| C. Pi provider | pi harness | browser as LLM backend | natural next upgrade |

## repo map

```
src/agent.mjs     the loop — local control, ChatGPT judgment
src/browser.mjs   CDP session, multi-turn ask()
src/protocol.mjs  tool ABI: fenced json in, fenced json out
src/tools/        tool implementations (shared with the MCP server)
src/server.mjs    MCP server (stdio transport, Option A path)
proto/            browser prototypes (query.mjs proved the transport)
docs/findings.md  what was tried, what worked, why
```

protocol invariant: fenced ```json, never angle-bracket tags — markdown
rendering strips bare tags before `innerText` sees them.

## conventions

- node, ESM, no typescript (prototype pace)
- playwright-core for browser (not bundled chromium — connects via CDP)
- test with `npm test` (unit) and `node bin/cli.mjs agent "<task>"` (live)

## browser prereqs

```bash
# Arc with remote debugging (reuses existing ChatGPT session)
open -a Arc --args --remote-debugging-port=9222
curl -s http://127.0.0.1:9222/json/version  # verify
```
