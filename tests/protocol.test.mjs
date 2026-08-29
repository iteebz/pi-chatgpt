import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, renderResult, systemPrompt } from "../src/protocol.mjs";

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
