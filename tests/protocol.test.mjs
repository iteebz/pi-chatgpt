import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, parseReply } from "../src/protocol.mjs";
import { renderResult, systemPrompt } from "../src/agent.mjs";

test("parses a fenced tool call", () => {
  const a = parse('```json\n{"tool":"shell","args":{"command":"ls"}}\n```');
  assert.equal(a.kind, "call");
  assert.equal(a.name, "shell");
  assert.deepEqual(a.args, { command: "ls" });
});

test("parses done", () => {
  assert.deepEqual(parse('```json\n{"done":"finished"}\n```'), { kind: "done", summary: "finished" });
});

test("accepts bare json without a fence", () => {
  assert.equal(parse('Here you go: {"tool":"grep","args":{"pattern":"x"}}').kind, "call");
});

test("accepts name/arguments aliases", () => {
  const a = parse('```\n{"name":"file_read","arguments":{"path":"/tmp"}}\n```');
  assert.equal(a.name, "file_read");
  assert.deepEqual(a.args, { path: "/tmp" });
});

test("prose without a call is not a call", () => {
  assert.equal(parse("I cannot do that.").kind, "prose");
});

test("prefers the fenced block over prose braces", () => {
  const reply = 'I considered {"tool":"rm"} but instead:\n```json\n{"tool":"shell","args":{}}\n```';
  assert.equal(parse(reply).name, "shell");
});

test("done wins over an illustrative call", () => {
  assert.equal(parse('```json\n{"done":"all set"}\n```').kind, "done");
});

test("system prompt advertises every registered tool", () => {
  const p = systemPrompt("do a thing", "/tmp");
  for (const name of ["shell", "file_read", "file_write", "grep", "git"]) assert.match(p, new RegExp(name));
  assert.match(p, /do a thing/);
  assert.match(p, /\/tmp/);
});

test("result rendering truncates instead of flooding the turn", () => {
  const out = renderResult({ stdout: "x".repeat(20_000) }, 500);
  assert.ok(out.length < 900);
  assert.match(out, /truncated/);
});

test("parseReply splits prose from the calls it carries", () => {
  const { text, calls } = parseReply('Reading both.\n```json\n{"tool":"read","args":{"path":"/a"}}\n```\n```json\n{"tool":"read","args":{"path":"/b"}}\n```');
  assert.equal(text, "Reading both.");
  assert.deepEqual(
    calls.map((c) => c.args.path),
    ["/a", "/b"],
  );
});

test("parseReply treats a reply with no fenced call as a finished turn", () => {
  const { text, calls } = parseReply("The file defines two exports.");
  assert.equal(calls.length, 0);
  assert.equal(text, "The file defines two exports.");
});

test("parseReply ignores json quoted in prose — only fences are the ABI", () => {
  const { calls } = parseReply('You could call {"tool":"rm","args":{}} but I will not.');
  assert.equal(calls.length, 0);
});

test("parseReply leaves non-call fenced blocks in the text", () => {
  const { text, calls } = parseReply('Here:\n```json\n{"port": 8080}\n```');
  assert.equal(calls.length, 0);
  assert.match(text, /8080/);
});
