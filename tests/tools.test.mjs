import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";

import { tools } from "../src/tools/index.mjs";

const shell = tools.get("shell");
const fileRead = tools.get("file_read");
const fileWrite = tools.get("file_write");
const grep = tools.get("grep");
const git = tools.get("git");

describe("shell", () => {
  it("runs a command and returns stdout", () => {
    const result = shell.execute({ command: "echo hello" });
    assert.equal(result.exit_code, 0);
    assert.equal(result.stdout.trim(), "hello");
  });

  it("returns exit code on failure", () => {
    const result = shell.execute({ command: "exit 42", cwd: "/tmp" });
    assert.equal(result.exit_code, 42);
  });

  it("respects cwd", () => {
    const result = shell.execute({ command: "pwd", cwd: "/tmp" });
    assert.equal(result.exit_code, 0);
    assert.match(result.stdout.trim(), /tmp/);
  });

  it("rejects missing command", () => {
    assert.throws(() => shell.execute({}), /command is required/);
  });
});

describe("file_read", () => {
  it("reads a file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pi-chatgpt-test-"));
    const file = join(tmp, "test.txt");
    writeFileSync(file, "hello world");

    const result = fileRead.execute({ path: file });
    assert.equal(result.type, "file");
    assert.equal(result.content, "hello world");
    assert.equal(result.truncated, false);
  });

  it("lists a directory", () => {
    const result = fileRead.execute({ path: "/tmp" });
    assert.equal(result.type, "directory");
    assert.ok(Array.isArray(result.entries));
  });

  it("truncates large content", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pi-chatgpt-test-"));
    const file = join(tmp, "big.txt");
    writeFileSync(file, "x".repeat(1000));

    const result = fileRead.execute({ path: file, max_chars: 100 });
    assert.equal(result.content.length, 100);
    assert.equal(result.truncated, true);
  });

  it("rejects missing path", () => {
    assert.throws(() => fileRead.execute({}), /path is required/);
  });
});

describe("file_write", () => {
  it("writes a file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pi-chatgpt-test-"));
    const file = join(tmp, "out.txt");

    const result = fileWrite.execute({ path: file, content: "test content" });
    assert.equal(result.bytes, 12);
    assert.equal(readFileSync(file, "utf-8"), "test content");
  });

  it("creates parent directories", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pi-chatgpt-test-"));
    const file = join(tmp, "a", "b", "c.txt");

    const result = fileWrite.execute({ path: file, content: "nested" });
    assert.equal(readFileSync(file, "utf-8"), "nested");
  });

  it("rejects missing path", () => {
    assert.throws(() => fileWrite.execute({ content: "x" }), /path is required/);
  });

  it("rejects missing content", () => {
    assert.throws(
      () => fileWrite.execute({ path: "/tmp/x" }),
      /content is required/
    );
  });
});

describe("grep", () => {
  it("finds matches in files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pi-chatgpt-test-"));
    writeFileSync(join(tmp, "a.txt"), "hello world\nfoo bar\nhello again");

    const result = grep.execute({ pattern: "hello", path: tmp });
    assert.equal(result.total, 2);
    assert.equal(result.matches.length, 2);
  });

  it("returns empty on no match", () => {
    const result = grep.execute({ pattern: "ZZZZNOTFOUND", path: "/tmp" });
    assert.equal(result.total, 0);
  });

  it("respects max_results", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pi-chatgpt-test-"));
    writeFileSync(join(tmp, "a.txt"), "x\nx\nx\nx\nx");

    const result = grep.execute({ pattern: "x", path: tmp, max_results: 2 });
    assert.equal(result.matches.length, 2);
    assert.equal(result.truncated, true);
  });

  it("rejects missing pattern", () => {
    assert.throws(() => grep.execute({}), /pattern is required/);
  });
});

describe("git", () => {
  it("runs git status", () => {
    const result = git.execute({ subcommand: "status --short", cwd: process.cwd() });
    assert.equal(typeof result.exit_code, "number");
  });

  it("runs git log", () => {
    const result = git.execute({ subcommand: "log --oneline -3", cwd: process.cwd() });
    assert.equal(result.exit_code, 0);
  });

  it("rejects missing subcommand", () => {
    assert.throws(() => git.execute({}), /subcommand is required/);
  });
});
