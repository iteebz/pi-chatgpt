import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, preamble, renderMessage } from "../src/pi/serialize.mjs";

const tools = [{ name: "read", description: "read a file", parameters: { type: "object", properties: {} } }];
const user = (text) => ({ role: "user", content: text, timestamp: 0 });
const assistantText = (text) => ({ role: "assistant", content: [{ type: "text", text }], timestamp: 0 });
const assistantCall = (name, args) => ({
  role: "assistant",
  content: [{ type: "toolCall", id: "x", name, arguments: args }],
  timestamp: 0,
});
const result = (toolName, text) => ({
  role: "toolResult",
  toolCallId: "x",
  toolName,
  content: [{ type: "text", text }],
  isError: false,
  timestamp: 0,
});

test("preamble carries pi's prompt, tools, and the ABI", () => {
  const p = preamble({ systemPrompt: "be terse", tools, messages: [] });
  assert.match(p, /be terse/);
  assert.match(p, /read: read a file/);
  assert.match(p, /fenced json/);
});

test("first turn rebuilds: preamble plus the whole conversation", () => {
  const step = plan(null, { systemPrompt: "s", tools, messages: [user("hi")] });
  assert.equal(step.mode, "rebuild");
  assert.match(step.text, /be terse|s/);
  assert.match(step.text, /USER\nhi/);
});

test("second turn appends only what the thread has not seen", () => {
  const context = { systemPrompt: "s", tools, messages: [user("hi")] };
  const first = plan(null, context);
  const next = {
    ...context,
    messages: [...context.messages, assistantCall("read", { path: "/a" }), result("read", "contents")],
  };
  const step = plan(first.state, next);
  assert.equal(step.mode, "append");
  assert.doesNotMatch(step.text, /USER\nhi/);
  assert.match(step.text, /TOOL RESULT — read/);
});

test("the thread's own reply is never sent back to it", () => {
  const context = { systemPrompt: "s", tools, messages: [user("hi")] };
  const first = plan(null, context);
  const step = plan(first.state, { ...context, messages: [...context.messages, assistantText("done")] });
  assert.equal(step.mode, "append");
  assert.equal(step.text, "Continue.");
});

test("rewritten history rebuilds — compaction must not leave a stale thread", () => {
  const context = { systemPrompt: "s", tools, messages: [user("hi"), user("more")] };
  const first = plan(null, context);
  const step = plan(first.state, { ...context, messages: [user("summary of earlier")] });
  assert.equal(step.mode, "rebuild");
  assert.match(step.text, /summary of earlier/);
});

test("a changed tool surface rebuilds — the thread was told the old one", () => {
  const context = { systemPrompt: "s", tools, messages: [user("hi")] };
  const first = plan(null, context);
  const step = plan(first.state, { ...context, tools: [...tools, { name: "write", description: "w" }] });
  assert.equal(step.mode, "rebuild");
});

test("assistant tool calls replay as the wire format on rebuild", () => {
  assert.equal(
    renderMessage(assistantCall("read", { path: "/a" })),
    'ASSISTANT\n```json\n{"tool":"read","args":{"path":"/a"}}\n```',
  );
});

test("images are named, not silently dropped", () => {
  const text = renderMessage({ role: "user", content: [{ type: "image", data: "x", mimeType: "image/png" }] });
  assert.match(text, /image omitted/);
});

test("a huge tool result is clipped before it reaches the composer", () => {
  const text = renderMessage(result("shell", "x".repeat(50_000)));
  assert.ok(text.length < 21_000);
  assert.match(text, /truncated/);
});
