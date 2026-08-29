# pi-chatgpt

## problem

ChatGPT Plus gives unlimited GPT-5.6 Sol via the conversation interface.
The Codex API and OpenAI API both meter usage (credits or tokens).
No existing tool lets pi use the unlimited conversation path as an LLM backend.

## objective

Pi extension that wraps ChatGPT's conversation UI as an LLM provider.
Browser automation against `backend-api/conversation` — the unlimited path.

```
pi (local harness)
  └── pi-chatgpt extension
        └── Playwright → ChatGPT web → backend-api/conversation
              └── Plus subscription, unlimited Sol
```

## prior art

- **pi-cc** — pi extension wrapping Claude Code as a provider (architecture reference)
- **codex-chatgpt-web** — Playwright driving ChatGPT web (DOM interaction reference)
- **agentify-desktop** — Electron + Playwright, multi-vendor (query/response loop reference)

## current state

- MCP server with 5 tools (shell, file_read, file_write, grep, git) — 21 tests passing.
  Useful if ChatGPT drives the loop, but not the goal. May repurpose or discard.
- Findings documented in `docs/findings.md` — four paths explored, browser
  automation is the viable one.

## next

1. Study codex-chatgpt-web and agentify-desktop extraction layers
2. Build pi provider that spawns headless browser, manages ChatGPT session
3. Expose `streamSimple` (pi's provider interface) over conversation UI
4. Verify zero credit/API usage on platform.openai.com/usage
