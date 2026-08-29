/**
 * The agent loop — local code owns control, ChatGPT owns judgment.
 *
 * Option B from docs/findings.md: browser session as transport, prose protocol
 * as the tool ABI, src/tools as the hands. No API key, no tunnel, no daemon.
 */

import { Session } from "./browser.mjs";
import { tools } from "./tools/index.mjs";
import { parse } from "./protocol.mjs";

/** The CLI's own system prompt: its tools, its one-call-per-reply discipline.
 *  The pi provider serves pi's tools instead — see src/pi/serialize.mjs. */
export function systemPrompt(task, cwd) {
  const specs = [...tools.values()].map((t) => {
    const args = Object.entries(t.schema)
      .map(([k, v]) => `${k}: ${v.type}${v.optional ? "?" : ""} — ${v.description}`)
      .join("\n    ");
    return `- ${t.name}: ${t.description}\n    ${args}`;
  });

  return `You are a coding agent acting on a real machine. You cannot touch it directly — I execute your tool calls and paste the results back.

Working directory: ${cwd}

TOOLS
${specs.join("\n")}

PROTOCOL
Every reply is exactly one fenced json block and nothing else. No prose outside it.

To act:
\`\`\`json
{"tool": "shell", "args": {"command": "ls -la"}}
\`\`\`

When the task is complete:
\`\`\`json
{"done": "one-line summary of what you did and what you found"}
\`\`\`

RULES
- One tool call per reply. Wait for the result before the next.
- Verify by contact: after writing files, run them or test them.
- Do not narrate, apologize, or ask permission. Act.
- If a tool errors, adapt and continue; if truly blocked, emit done with the reason.

TASK
${task}`;
}

export function renderResult(result, maxChars = 6000) {
  let text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
  return `TOOL RESULT\n\`\`\`json\n${text}\n\`\`\`\nNext tool call, or done.`;
}

export async function run(task, { cwd = process.cwd(), maxSteps = 20, log = () => {} } = {}) {
  const session = await new Session().open();
  const trace = [];

  try {
    let message = systemPrompt(task, cwd);

    for (let step = 1; step <= maxSteps; step++) {
      const t0 = Date.now();
      const reply = await session.ask(message);
      const ms = Date.now() - t0;
      const action = parse(reply);

      if (action.kind === "done") {
        log(`✓ ${action.summary}`);
        trace.push({ step, ms, done: action.summary });
        return { status: "done", summary: action.summary, steps: step, trace };
      }

      if (action.kind === "prose") {
        log(`… no tool call (step ${step}), reprompting`);
        trace.push({ step, ms, prose: reply.slice(0, 200) });
        message = "That reply had no fenced json block. Reply with exactly one fenced json tool call, or {\"done\": \"...\"}.";
        continue;
      }

      const tool = tools.get(action.name);
      log(`→ [${(ms / 1000).toFixed(1)}s] ${action.name} ${JSON.stringify(action.args).slice(0, 100)}`);

      let result;
      if (!tool) {
        result = { error: `Unknown tool "${action.name}". Available: ${[...tools.keys()].join(", ")}` };
      } else {
        try {
          result = await tool.execute({ cwd, ...action.args });
        } catch (err) {
          result = { error: err.message };
        }
      }

      trace.push({ step, ms, tool: action.name, args: action.args, result });
      message = renderResult(result);
    }

    return { status: "max_steps", steps: maxSteps, trace };
  } finally {
    await session.close();
  }
}
