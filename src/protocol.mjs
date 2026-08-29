/**
 * Tool-call protocol carried over prose — the wire format, shared by both
 * consumers (agent CLI, pi provider).
 *
 * ChatGPT web has no native function calling, so the contract is a fenced JSON
 * block. Fences survive markdown rendering; bare angle-bracket tags do not
 * (innerText drops them as HTML). Parsing is tolerant by design: the model is
 * the wire format, so accept any fenced JSON that looks like a call.
 *
 * Two readers, two tolerances. `parse` serves the CLI: one action per reply,
 * bare braces accepted because the reply is nothing but the call. `parseReply`
 * serves the pi provider: prose and calls coexist in one turn, so only fenced
 * blocks count — a JSON object quoted in prose is prose.
 */

export function parse(reply) {
  for (const raw of candidates(reply)) {
    const obj = tryJson(raw);
    if (!obj) continue;
    if (typeof obj.done === "string") return { kind: "done", summary: obj.done };
    const call = asCall(obj);
    if (call) return { kind: "call", ...call };
  }
  return { kind: "prose", text: reply };
}

/** Split an assistant reply into user-visible text and the tool calls it carries. */
export function parseReply(reply) {
  const calls = [];
  const text = reply
    .replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, (block, body) => {
      const call = asCall(tryJson(body.trim()));
      if (!call) return block;
      calls.push(call);
      return "";
    })
    .trim();
  return { text, calls };
}

function tryJson(raw) {
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

function asCall(obj) {
  if (!obj) return null;
  const name = obj.tool || obj.name;
  if (typeof name !== "string") return null;
  const args = obj.args || obj.arguments || {};
  return { name, args: typeof args === "object" && args !== null ? args : {} };
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
