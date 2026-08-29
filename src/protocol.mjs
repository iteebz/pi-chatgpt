/**
 * Tool-call protocol carried over prose.
 *
 * ChatGPT web has no native function calling, so the contract is a fenced JSON
 * block. Fences survive markdown rendering; bare angle-bracket tags do not
 * (innerText drops them as HTML). Parsing is tolerant by design: the model is
 * the wire format, so accept any fenced JSON that looks like a call.
 */

import { tools } from "./tools/index.mjs";

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

export function parse(reply) {
  for (const raw of candidates(reply)) {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object") {
      if (typeof obj.done === "string") return { kind: "done", summary: obj.done };
      const name = obj.tool || obj.name;
      if (typeof name === "string") return { kind: "call", name, args: obj.args || obj.arguments || {} };
    }
  }
  return { kind: "prose", text: reply };
}

/** Fenced blocks first, then any balanced top-level JSON object in the text. */
function* candidates(reply) {
  const fenced = reply.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g);
  for (const m of fenced) yield m[1].trim();

  let depth = 0;
  let start = -1;
  for (let i = 0; i < reply.length; i++) {
    const c = reply[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) yield reply.slice(start, i + 1);
      if (depth < 0) depth = 0;
    }
  }
}

export function renderResult(result, maxChars = 6000) {
  let text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
  return `TOOL RESULT\n\`\`\`json\n${text}\n\`\`\`\nNext tool call, or done.`;
}
