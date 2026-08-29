# pi-chatgpt

## invariant

**Free ChatGPT only.** No OpenAI API key. No Codex quota. No metered path, ever.
This is the reason the project exists — violate it and there is nothing left
worth shipping.

Enforced, not trusted: `tests/invariant.test.mjs` scans `src/`, `bin/`, and
`package.json` for credentials, paid endpoints, Codex backends, and tunnel
dependencies. It fails the build. Verified to fail by planting a violation.

Consequences already taken: the OpenAI tunnel path (Option A) is closed — it
requires a runtime API key. Its MCP server and stdio transport are deleted, not
archived.

## problem

ChatGPT Plus gives unlimited GPT-5.6 Sol via the conversation interface.
The Codex API and OpenAI API both meter usage (credits or tokens).
No existing tool turns the unlimited conversation path into a coding agent
that can act on the local machine.

## goal

ChatGPT Sol as a coding agent on this computer. Unlimited inference via
Plus subscription. Zero API spend.

## proven

- **The pi provider works.** `pi -e src/pi/index.mjs --model chatgpt-web` — pi
  owns the loop, tools, context, and TUI; ChatGPT is the model. Probed end to
  end: read a file and answered; wrote a script, ran it, verified the output.
- **The agent loop works.** `node bin/cli.mjs agent "<task>"` — ChatGPT Plus
  plans, local code executes, results paste back. Probed end to end: wrote and
  ran a script; explored the repo across 4 tools and wrote a verified summary.
- Browser automation via CDP: Playwright connects to Arc, reuses the logged-in
  ChatGPT Plus session, sends prompts, polls DOM for responses.
- Zero credentials in the agent path: no API key, no token, no Authorization
  header, no OpenAI endpoint. Codex quota is untouched because Codex is never
  involved. Traffic is the normal chat endpoint on your logged-in session.

## architecture

`docs/architecture.md` is the layer map: core (browser + protocol) under two
consumers (agent CLI, pi provider). **The pi provider is the premier surface** —
`~/dev/fork/pi` is the harness everything compounds in, and pi-cc is the
template. `docs/findings.md` is the exploration log. Three paths were weighed:

| option | who owns the loop | transport | status |
|--------|-------------------|-----------|--------|
| A. OpenAI tunnel | ChatGPT | native MCP via tunnel-client | **closed — needs an API key** |
| B. Browser agent loop | local code | browser DOM | **shipped, works** |
| C. Pi provider | pi harness | browser as LLM backend | **shipped, works** |

## repo map

```
src/browser.mjs   core — CDP session, multi-turn ask(), markdown recovery
src/protocol.mjs  core — tool ABI: fenced json in, fenced json out
src/pi/           pi provider — index (registration) · provider (turn) · serialize (diff)
src/agent.mjs     agent CLI — its own loop, its own prompt
src/tools/        agent CLI's tools (the provider uses pi's instead)
proto/            browser prototypes (query.mjs proved the transport)
docs/architecture.md  layer map — core vs consumers, provider contract
docs/findings.md      what was tried, what worked, why
```

protocol invariant: fenced ```json, never angle-bracket tags — markdown
rendering strips bare tags before `innerText` sees them.

## conventions

- node, ESM, no typescript (prototype pace)
- playwright-core is the only dependency — a new one must carry no metered path
- test with `npm test` (unit), `node bin/cli.mjs agent "<task>"` (live CLI), and
  `pi -e src/pi/index.mjs --model chatgpt-web -p "<task>"` (live provider)
- `PI_CHATGPT_TRACE=<file>` dumps the verbatim thread. Read it before theorizing
  about a prompt bug — pi's TUI shows the parsed result, not what the model saw.

## browser prereqs

```bash
# Arc with remote debugging (reuses existing ChatGPT session)
open -a Arc --args --remote-debugging-port=9222
curl -s http://127.0.0.1:9222/json/version  # verify
```
