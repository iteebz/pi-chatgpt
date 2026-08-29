import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

function sendJsonRpc(proc, method, params = {}, id) {
  const msg = JSON.stringify({
    jsonrpc: "2.0",
    ...(id !== undefined ? { id } : {}),
    method,
    params,
  });
  proc.stdin.write(msg + "\n");
}

function readJsonRpc(proc, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeout);
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id !== undefined) {
            clearTimeout(timer);
            proc.stdout.off("data", onData);
            resolve(parsed);
            return;
          }
        } catch {}
      }
    };
    proc.stdout.on("data", onData);
  });
}

describe("MCP server", () => {
  it("responds to initialize and lists tools", async () => {
    const proc = spawn(
      "node",
      [join(import.meta.dirname, "../src/server.mjs")],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    try {
      sendJsonRpc(
        proc,
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.1.0" },
        },
        1
      );
      const initResult = await readJsonRpc(proc);
      assert.equal(initResult.result.serverInfo.name, "pi-chatgpt");

      // Initialized notification
      sendJsonRpc(proc, "notifications/initialized");

      sendJsonRpc(proc, "tools/list", {}, 2);
      const toolsResult = await readJsonRpc(proc);
      const toolNames = toolsResult.result.tools.map((t) => t.name).sort();
      assert.deepEqual(toolNames, ["file_read", "file_write", "git", "grep", "shell"]);
    } finally {
      proc.kill();
    }
  });

  it("executes shell tool via MCP", async () => {
    const proc = spawn(
      "node",
      [join(import.meta.dirname, "../src/server.mjs")],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    try {
      sendJsonRpc(
        proc,
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.1.0" },
        },
        1
      );
      await readJsonRpc(proc);
      sendJsonRpc(proc, "notifications/initialized");

      sendJsonRpc(
        proc,
        "tools/call",
        { name: "shell", arguments: { command: "echo mcp-works" } },
        3
      );
      const callResult = await readJsonRpc(proc);
      const output = JSON.parse(callResult.result.content[0].text);
      assert.equal(output.exit_code, 0);
      assert.match(output.stdout, /mcp-works/);
    } finally {
      proc.kill();
    }
  });
});
