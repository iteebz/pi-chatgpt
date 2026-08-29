# pi-chatgpt

## problem

OpenAI's API charges per token. ChatGPT Plus gives unlimited GPT-5.6 Sol.
Codex exists but is API-gated. There is no way to use your ChatGPT
subscription as a local coding agent — until now.

## objective

Turn ChatGPT Plus into a Codex-like coding agent on your machine, at zero
marginal cost. No API spend. No browser automation. ChatGPT is already an
MCP client — pi-chatgpt is the MCP server that gives it hands.

```
ChatGPT web (Plus sub, unlimited Sol)
  → MCP connector
  → OpenAI tunnel (free control-plane auth)
  → pi-chatgpt (local stdio)
  → your machine: shell, files, git, grep
```

## architecture

Minimal MCP server over stdio. `tunnel-client` bridges to ChatGPT web via
outbound HTTPS polling — no inbound ports, no public endpoints.

Three layers, in priority order:

1. **Tools** — what ChatGPT can do on your machine
2. **Context** — system prompt that orients ChatGPT to your environment
3. **Safety** — boundaries so unlimited power doesn't mean unlimited damage

## tools

| tool | status |
|------|--------|
| `shell` | ✓ shipped |
| `file_read` | ✓ shipped |
| `file_write` | ✓ shipped |
| `grep` | planned |
| `git` | planned |

## ship gate

Tunnel integration: `tunnel-client run` → ChatGPT connector → tool call round-trip verified.

## non-goals

- No API usage. Ever. The whole point is the Plus subscription.
- No browser automation. ChatGPT speaks MCP natively.
- No Electron wrapper. This is a CLI tool.
