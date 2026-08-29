# Findings

What we learned exploring how to tap ChatGPT Plus unlimited Sol as a local
coding agent backend.

## The goal

Unlimited GPT-5.6 Sol driving a coding agent on the local machine. Plus
subscription pays for inference — zero API spend, zero credits drawn.

## Verified

### The pi provider works (Option C, shipped)

`pi -e src/pi/index.mjs --model chatgpt-web` — pi's loop, pi's tools, ChatGPT as
the model. Two probes: read a file and report a field (2 turns), write
fizzbuzz.py + run it + confirm the output (3 turns, file on disk).

Three things had to be discovered by contact:

- **The DOM eats fences.** A json fence renders to `<pre><code>` and `innerText`
  returns `JSON\n{...}` — markers gone, language demoted to a UI label. The CLI
  never noticed because its parser accepts bare braces. The provider cannot:
  prose and calls share a turn, so a JSON object quoted in prose must not
  execute. `browser.mjs` now rebuilds fences from the code elements, which fixes
  both consumers.
- **ChatGPT refuses before it obeys.** Three distinct refusals in sequence: "I
  can't access that path from this environment", "the tool isn't available in
  this chat's tool interface", and a real attempt through its own code
  interpreter reporting ENOENT. pi's system prompt assumes native tools and
  never explains how they arrive. Fixed by framing the machine as real *before*
  pi's prompt, forbidding its own tools by name, and asserting that writing the
  block *is* the action — there is nothing to invoke.
- **Usage must be faked upward, not to zero.** pi's auto-compaction reads token
  counts. Zero is the honest number and the wrong one: nothing would ever
  compact and the thread would hit its own invisible ceiling with pi believing
  the context was empty. Estimated at 4 chars/token instead.

### The agent loop works (Option B, shipped)

`node bin/cli.mjs agent "<task>"` — ChatGPT Plus drives real tools on this
machine. Zero API spend, zero credentials, no daemon.

| probe | result |
|-------|--------|
| write fizzbuzz.py, run it, confirm output | ✅ 2 turns, correct output |
| explore repo → read → grep → write summary → verify | ✅ 5 turns, 4 distinct tools |

What made it work:

- **Fenced JSON, not tags.** `<tool_call>` disappears — markdown rendering eats
  bare angle brackets before `innerText` sees them. A ```json fence survives.
- **Turn counting, not text diffing.** A reply identical to the previous one
  still resolves because turn boundaries come from assistant node count.
- **Tolerant parsing.** The model is the wire format. Accept `tool`/`name`,
  `args`/`arguments`, fenced or bare, prose before the block.
- **Reprompt on prose.** No fenced block → one corrective nudge, not a crash.

Open limits: temporary-chat context grows every turn with no compaction; tool
results truncate at 6k chars; the browser must be up with the port open.

### Browser automation works

Playwright connects to Arc via CDP (`open -a Arc --args --remote-debugging-port=9222`),
reuses the existing ChatGPT Plus session. DOM polling extracts responses reliably.

Tested with `proto/query.mjs`:

| test | result | time |
|------|--------|------|
| one-word answer | ✅ | 5.1s |
| code generation (666 chars) | ✅ | 5.5s |
| long essay (9,513 chars) | ✅ | 36.5s |

### What doesn't work

- **Headless Playwright** → Cloudflare captcha. Must connect to real browser.
- **Network interception** → SSE body truncated over CDP. The delta encoding
  v1 parser works (append/patch on content parts) but `response.text()` returns
  before the stream finishes.
- **Clipboard extraction** → copy button blocked by overlay div.
- **Direct `backend-api/conversation`** → proof tokens, requirements tokens,
  CSRF tokens. Designed to reject non-browser clients. Cat-and-mouse.

### MCP server exists

5 tools (shell, file_read, file_write, grep, git), 21 tests passing.
Originally built for the tunnel path. Reusable by any architecture.

## Architecture options

Three ways to connect ChatGPT (brain) to local tools (hands):

### Option A: OpenAI tunnel (native MCP)

```
ChatGPT web ──native MCP──▶ tunnel-client daemon ──▶ pi-chatgpt MCP server
                                                       ├── shell
                                                       ├── file_read/write
                                                       └── grep, git
```

ChatGPT owns the agent loop. Calls tools natively via MCP protocol.

- **Pro:** clean protocol, ChatGPT handles tool calling natively, MCP server
  already built
- **Con:** requires tunnel ID + runtime API key + daemon process, OpenAI infra
  dependency, another credential to manage
- **Status:** tunnel ID stored in vault. Need runtime API key from
  platform.openai.com/settings/organization/api-keys

### Option B: Browser agent loop (prompt-engineered tools)

```
agent loop (local)
  ├── send system prompt + tool defs + task to ChatGPT via browser
  ├── ChatGPT responds with tool call or final answer
  ├── parse tool call → execute locally → paste result back
  └── repeat until done
```

Local code owns the agent loop. ChatGPT is the LLM brain. Browser is the
transport layer.

- **Pro:** zero additional setup, no credentials, no daemon, already proved
  browser query works, both pieces exist (proto/query.mjs + src/tools/)
- **Con:** prompt-engineered tool protocol (fragile?), multi-turn conversation
  management in DOM, need to design tool call format
- **Ref:** CatGPT does exactly this — instructs ChatGPT to output structured
  JSON tool calls, parses and executes them

Tool call format (strawman):
```
<tool_call>{"name":"shell","args":{"command":"ls -la"}}</tool_call>
```

### Option C: Pi provider (browser as LLM backend)

```
pi (agent harness)
  └── pi-chatgpt provider
        └── browser → ChatGPT → DOM polling → response text
```

Pi owns the agent loop and tool execution. ChatGPT is just an LLM endpoint.
The pi-cc pattern applied to a browser subprocess.

- **Pro:** pi's existing tool system, context management, skills, and session
  handling. Just swap the LLM backend.
- **Con:** most complex. Browser automation + pi provider interface. Pi
  handles tools, so ChatGPT doesn't need to know about them — but then
  we're paying the pi tax on every call.
- **Ref:** pi-cc wraps Claude Code this way. ~300 lines of provider glue.

### Outcome

**Option B shipped and works.** ~250 lines: `src/browser.mjs` (transport),
`src/protocol.mjs` (tool ABI over prose), `src/agent.mjs` (loop). ChatGPT is
smart enough to follow a prompt-engineered tool protocol — that was the open
question, and it is answered.

Option A is closed by invariant: the tunnel needs a runtime API key, and this
project ships no credentials. Its MCP server is deleted.

**Option C shipped too**, and the "pi tax" worry did not materialize — the
provider is ~150 lines of glue on top of the same `Session.ask()`, because the
transport was already isolated behind it. Both consumers run on one core.

## Reference repos

| repo | path | useful for |
|------|------|------------|
| pi-cc | `~/dev/fork/pi-cc` | pi extension architecture, provider registration |
| pi | `~/dev/fork/pi` | agent harness, provider interface, OAuth |
| codex-chatgpt-web | `~/dev/fork/codex-chatgpt-web` | ChatGPT DOM interaction, turn broker, MCP bridge |
| agentify-desktop | `~/dev/fork/agentify-desktop` | multi-vendor browser automation, chatgpt-controller |
| codex | `~/dev/fork/codex` | Codex CLI source, auth model |

## Auth landscape

```
OPENAI_API_KEY          → OpenAI API       → billed per token ($$$)
openai-codex OAuth      → backend-api/codex → billed in credits (limited)
ChatGPT session (Arc)   → backend-api/conversation → unlimited (Plus sub)
```

## SSE format notes (for future network interception)

ChatGPT uses delta encoding v1. Not raw message objects — JSON patch-like ops:

```
event: delta
data: {"p":"/message/content/parts/0","o":"append","v":"hello"}

event: delta
data: {"o":"patch","v":[
  {"p":"/message/content/parts/0","o":"append","v":" world"},
  {"p":"/message/status","o":"replace","v":"finished_successfully"}
]}
```

Parser exists in `proto/network-intercept.mjs` but body buffering is broken.
