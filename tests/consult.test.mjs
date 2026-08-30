import { test } from "node:test";
import assert from "node:assert";
import { chunk } from "../src/consult.mjs";
import { slug } from "../src/session-log.mjs";

test("chunk splits on paragraph boundaries", () => {
  const text = ["a".repeat(80), "b".repeat(80), "c".repeat(80)].join("\n\n");
  const parts = chunk(text, 100);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => !p.includes("\n\n")));
});

test("chunk hard-splits a paragraph larger than the limit", () => {
  const parts = chunk("x".repeat(250), 100);
  assert.equal(parts.length, 3);
  assert.equal(parts.join("").length, 250);
});

test("chunk returns one part when it fits", () => {
  assert.deepEqual(chunk("short", 100), ["short"]);
});

test("slug matches pi's session directory naming", () => {
  assert.equal(slug("/Users/iteebz/distil"), "--Users-iteebz-distil--");
});
