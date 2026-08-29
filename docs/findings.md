# Findings

What we learned exploring how to tap ChatGPT Plus unlimited Sol as a local
coding agent backend.

## The goal

Pi drives the agent loop locally. ChatGPT is the LLM brain. Plus subscription
pays for inference — zero API spend, zero credits drawn.

## Paths explored

### 1. MCP server + tunnel (discarded)

Built a working MCP server (shell, file_read, file_write, grep, git) with
21 tests. Registered it via `codex mcp add`. Investigated OpenAI's
`tunnel-client` for bridging to ChatGPT web.

**Why it fails:** The tunnel goes the wrong direction. It lets ChatGPT call
tools on your laptop. We need the reverse — our laptop calling ChatGPT for
inference. The tunnel doesn't provide that.

### 2. Pi's `openai-codex` provider (insufficient)

Pi already has an `openai-codex` provider using ChatGPT OAuth against
`chatgpt.com/backend-api/codex`. Same auth as Codex CLI.

**Why it fails:** Codex API uses a credit system, not the unlimited
conversation interface. Plus gets 10-100 Sol messages per 5-hour window.
Credits cost $0.04 each after that. This is the Codex billing path, not the
ChatGPT conversation path.

### 3. Browser automation (viable)

What codex-chatgpt-web and agentify-desktop both do. Playwright drives
ChatGPT's web UI — types prompts, reads responses from the DOM.

**Why it works:** Hits `backend-api/conversation`, the actual unlimited
subscription interface. No credit metering. Same UI you use when you type
in ChatGPT.

**Trade-offs:** Fragile to DOM changes. Requires a browser process. But
both reference repos prove it works.

### 4. Direct `backend-api/conversation` (viable, risky)

Use the same session tokens pi already has (`pi auth print-bearer-token
--provider openai-codex`) to call `chatgpt.com/backend-api/conversation`
directly. Skip the browser, hit the endpoint.

**Why it might work:** Same auth, different endpoint. Conversation endpoint
is what the ChatGPT web app calls internally.

**Risks:** Undocumented internal API. Could break or get blocked. ToS grey
area.

## Direction

pi-chatgpt becomes a pi extension that wraps browser automation (path 3) as
an LLM provider. Prior art:

- **pi-cc** — pi extension wrapping Claude Code as a provider subprocess
- **codex-chatgpt-web** — Playwright driving ChatGPT web, translating to
  Codex's Responses API
- **agentify-desktop** — Electron + Playwright exposing MCP tools that type
  into ChatGPT/Claude/etc

The cleanest design: a pi provider that spawns a headless browser, manages a
ChatGPT session, and exposes `streamSimple` (pi's provider interface) by
sending prompts and streaming responses from the conversation UI.

## Key references

| repo | what it does | useful for |
|------|-------------|------------|
| `~/dev/fork/pi-cc` | pi extension wrapping Claude Code | Extension architecture, provider registration |
| `~/dev/fork/pi` | pi agent harness, `openai-codex` OAuth | Auth flow, provider interface |
| `~/dev/fork/codex-chatgpt-web` | Playwright → ChatGPT → Codex API | ChatGPT DOM interaction, response extraction |
| `~/dev/fork/agentify-desktop` | Electron MCP → ChatGPT/Claude/etc | Multi-vendor browser automation, query/response loop |
| `~/dev/fork/codex` | Codex CLI source (Rust) | `chatgpt_client.rs`, auth model, `backend-api` usage |

## Auth landscape

```
OPENAI_API_KEY          → OpenAI API → billed per token ($$$)
openai-codex OAuth      → backend-api/codex → billed in credits (limited)
ChatGPT session         → backend-api/conversation → unlimited (Plus sub)
```

All three use the same account. Only the third is truly unlimited.
