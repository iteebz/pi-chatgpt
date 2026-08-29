# pi-chatgpt

## problem

ChatGPT Plus gives unlimited GPT-5.6 Sol. The API charges per token.
The goal is a local coding agent powered by the subscription, not the API.

## discovery

Pi already solves this. The `openai-codex` provider in pi-ai authenticates
via ChatGPT OAuth (same flow as Codex CLI), hits `chatgpt.com/backend-api`,
and bills against the Plus subscription — zero API spend.

```
pi --model openai-codex/gpt-5.6-sol
```

That's it. Pi is the centralised harness. The LLM backend is swappable:

| harness | provider | backend | billing |
|---------|----------|---------|---------|
| pi + pi-cc | `cc` (Claude Code) | Anthropic via claude binary | Max sub |
| pi + openai-codex | `openai-codex` | ChatGPT via OAuth | Plus sub |
| codex CLI | native | ChatGPT via OAuth | Plus sub |

pi-cc is prior art: a pi extension that registers Claude Code as a provider.
pi-chatgpt was scoped as an MCP server giving ChatGPT local tools, but the
real need — pi as agent, ChatGPT as brain — is already built into pi-ai.

## what pi-chatgpt becomes

Not an MCP server. A **pi extension** (like pi-cc) that:

1. Wraps `openai-codex` with distil-specific context (AGENTS.md, skills, vault)
2. Provides a `pi-chatgpt` command or alias: `pi --model openai-codex/gpt-5.6-sol`
3. Verifies zero API spend (subscription-only auth, no OPENAI_API_KEY fallback)

The MCP tools (shell, file_read, file_write, grep, git) we built are
redundant — pi already has all of these natively.

## architecture

```
pi (local harness)
  ├── pi-cc extension → Claude Code → Max sub
  ├── openai-codex provider (built-in) → ChatGPT → Plus sub
  └── pi-chatgpt extension (planned) → distil context + guardrails
        └── delegates to openai-codex provider
```

## references

- `~/dev/fork/pi/packages/ai/src/auth/oauth/openai-codex.ts` — OAuth flow
- `~/dev/fork/pi/packages/ai/src/providers/openai-codex.ts` — provider config
- `~/dev/fork/pi-cc/` — prior art: pi extension wrapping a provider
- `~/dev/fork/codex/codex-rs/chatgpt/` — Codex CLI's ChatGPT client (Rust)
- `~/.codex/auth.json` — shared session tokens (auth_mode: chatgpt)

## verification

```bash
# Confirm subscription auth, not API key
pi auth print-bearer-token --provider openai-codex
# JWT contains chatgpt_plan_type: "plus" — subscription, not API

# Run pi with Sol
pi --model openai-codex/gpt-5.6-sol

# Verify no API usage at platform.openai.com/usage — should show $0
```

## non-goals

- MCP server for ChatGPT web (tunnel approach) — deferred, not the core need
- Browser automation (codex-chatgpt-web, agentify) — wrong layer
- API usage of any kind — the whole point is the subscription
