#!/usr/bin/env node

/**
 * pi-chatgpt CLI.
 *
 * Usage:
 *   pi-chatgpt serve    Start the MCP server on stdio
 *   pi-chatgpt test     Run a quick self-test
 */

const cmd = process.argv[2];

if (cmd === "serve" || !cmd) {
  await import("../src/server.mjs");
} else if (cmd === "test") {
  const { tools } = await import("../src/tools/index.mjs");
  const result = tools.get("shell").execute({ command: "echo pi-chatgpt-ok" });
  if (result.exit_code === 0 && result.stdout.includes("pi-chatgpt-ok")) {
    console.log("✓ shell tool works");
  } else {
    console.error("✗ shell tool failed", result);
    process.exit(1);
  }
  console.log(`✓ ${tools.size} tools registered: ${[...tools.keys()].join(", ")}`);
} else {
  console.error(`Unknown command: ${cmd}`);
  console.error("Usage: pi-chatgpt [serve|test]");
  process.exit(1);
}
