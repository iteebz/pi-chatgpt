#!/usr/bin/env node

/**
 * pi-chatgpt CLI.
 *
 * Usage:
 *   pi-chatgpt agent <task>          Run the browser agent loop (ChatGPT drives, we execute)
 *   pi-chatgpt consult [-f f] <q>   One-shot ask with memory, no memory writes
 *   pi-chatgpt test                 Run a quick self-test
 */

const cmd = process.argv[2];

if (cmd === "consult") {
  const args = process.argv.slice(3);
  const files = [];
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-f" || args[i] === "--file") files.push(args[++i]);
    else words.push(args[i]);
  }
  const question = words.join(" ");
  if (!question) {
    console.error("Usage: pi-chatgpt consult [-f <file>]... <question>");
    process.exit(1);
  }
  const { consult } = await import("../src/consult.mjs");
  console.log(await consult(question, { files }));
} else if (cmd === "agent" || (!cmd && process.argv.length > 2)) {
  const task = process.argv.slice(3).join(" ");
  if (!task) {
    console.error("Usage: pi-chatgpt agent <task>");
    process.exit(1);
  }
  const { run } = await import("../src/agent.mjs");
  const result = await run(task, { log: (m) => console.error(m) });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "done" ? 0 : 1);
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
  console.error("Usage: pi-chatgpt [agent <task>|consult [-f <file>]... <question>|test]");
  process.exit(1);
}
