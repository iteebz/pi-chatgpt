/**
 * pi's Context → chat thread text.
 *
 * The thread is the session: ChatGPT already holds every earlier turn, so a
 * turn sends only what is new. That makes this module a diff, not a serializer,
 * and the diff needs a drift check — pi rewrites its message array on compaction
 * and session-tree navigation, and a thread that silently kept the old history
 * would answer from a past that no longer exists. Fingerprint the messages we
 * have represented; when the live array stops extending that prefix, the thread
 * is wrong and must be rebuilt from scratch.
 *
 * Pure — no browser, no state of its own. `plan` takes the old state and returns
 * the text to send plus the new state.
 */

import { createHash } from "node:crypto";

const MAX_MESSAGE_CHARS = 20_000;

// Leads the thread. pi's system prompt assumes a model with native tools and
// says nothing about how they arrive, so without this framing ChatGPT answers
// from its default prior — "I can't access that path from this environment" —
// and never calls anything. Measured: refusal on the first probe, tool call on
// the same task once this preceded pi's prompt.
const FRAMING = `You are the model behind a coding agent running on a real machine.
You cannot touch that machine directly and you are not sandboxed: a harness
executes your tool calls on the user's computer and pastes the results back.
Every path, file, and command below is real and reachable. Never claim you lack
access to something — call the tool and find out.`;

const PROTOCOL = `PROTOCOL
There is no tool interface in this chat and you do not need one. I read your
reply as plain text. When it contains a fenced json block, I run that command on
the machine myself and paste the output back as a message labelled TOOL RESULT.
Writing the block *is* the action — nothing else is required of you, and there
is nothing to invoke.

So to read a file, your entire reply is:

\`\`\`json
{"tool": "read", "args": {"path": "/tmp/x"}}
\`\`\`

RULES
- Never say a tool is unavailable to you. None of them are available to you;
  they are available to me, and I run them when you write the block.
- Never use your own tools — python, code interpreter, file uploads, browsing,
  canvas. Those run on someone else's machine, not the user's, and will fail on
  every path here.
- One fenced json block per call. Several blocks in a reply means several calls.
- Prose outside the fences is shown to the user. Keep it to one short line when
  you are calling a tool; write freely when you are answering.
- A reply with no fenced call ends your turn and hands control back to the user.
- A fenced json block is *always* read as a tool call. To show JSON without
  calling anything, use a different fence language or indent it.
- Arguments must match the parameter schema exactly. No extra keys.`;

/** Turn one of the thread: pi's system prompt, pi's tools, and the ABI. */
export function preamble(context) {
  const tools = (context.tools ?? []).map(
    (t) => `- ${t.name}: ${t.description}\n  parameters: ${JSON.stringify(t.parameters ?? {})}`,
  );
  return [
    FRAMING,
    context.systemPrompt?.trim() ? `AGENT INSTRUCTIONS\n${context.systemPrompt.trim()}` : null,
    tools.length ? `TOOLS\n${tools.join("\n")}` : "TOOLS\n(none — answer directly)",
    PROTOCOL,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function renderMessage(msg) {
  if (msg.role === "user") return `USER\n${clip(contentText(msg.content))}`;
  if (msg.role === "assistant") {
    const parts = [];
    for (const block of msg.content ?? []) {
      if (block.type === "text" && block.text) parts.push(block.text);
      else if (block.type === "toolCall")
        parts.push(`\`\`\`json\n${JSON.stringify({ tool: block.name, args: block.arguments })}\n\`\`\``);
    }
    return parts.length ? `ASSISTANT\n${clip(parts.join("\n\n"))}` : null;
  }
  if (msg.role === "toolResult") {
    const status = msg.isError ? " (error)" : "";
    return `TOOL RESULT — ${msg.toolName}${status}\n\`\`\`\n${clip(contentText(msg.content))}\n\`\`\``;
  }
  return null;
}

/**
 * Decide what to send this turn.
 *
 * `rebuild` — new thread, preamble plus the whole conversation.
 * `append`  — only the messages the thread has not seen. Assistant messages in
 *             the tail are the thread's own replies coming back to us; sending
 *             them would make the model read its own words as user input.
 */
export function plan(state, context) {
  const key = identity(context);
  const hashes = fingerprint(context.messages ?? []);
  const stale = !state || state.key !== key || !isPrefix(state.hashes, hashes);

  if (stale) {
    const body = (context.messages ?? []).map(renderMessage).filter(Boolean);
    const text = [preamble(context), body.length ? body.join("\n\n") : null].filter(Boolean).join("\n\n");
    return { mode: "rebuild", text, state: { key, hashes } };
  }

  const fresh = (context.messages ?? []).slice(state.hashes.length);
  const body = fresh
    .filter((m) => m.role !== "assistant")
    .map(renderMessage)
    .filter(Boolean);
  // Nothing new but our own reply: pi is asking for another turn on the same
  // history, which only happens after an empty or unusable one.
  const text = body.length ? body.join("\n\n") : "Continue.";
  return { mode: "append", text, state: { key, hashes } };
}

/** What forces a new thread when it changes: the prompt and the tool surface. */
function identity(context) {
  const tools = (context.tools ?? []).map((t) => `${t.name}:${JSON.stringify(t.parameters ?? {})}`).join("|");
  return hash(`${context.systemPrompt ?? ""}\u0000${tools}`);
}

export function fingerprint(messages) {
  return messages.map((m) => hash(JSON.stringify([m.role, m.content ?? "", m.toolCallId ?? "", m.toolName ?? ""])));
}

function isPrefix(prefix, full) {
  if (!prefix || prefix.length > full.length) return false;
  return prefix.every((h, i) => h === full[i]);
}

function hash(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

export function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (b.type === "text" ? b.text : b.type === "image" ? "[image omitted — thread accepts text only]" : ""))
    .filter(Boolean)
    .join("\n");
}

function clip(text, max = MAX_MESSAGE_CHARS) {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]` : text;
}
