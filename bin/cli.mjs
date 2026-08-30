#!/usr/bin/env node

/**
 * pi-chatgpt CLI.
 *
 * Usage:
 *   pi-chatgpt agent <task>               Browser agent loop (ChatGPT drives, we execute)
 *   pi-chatgpt consult [-f file] [-s n] <q>   Ask Kit — your memory, your instructions, free
 *   pi-chatgpt sessions [cwd]             List pi sessions, newest first
 *   pi-chatgpt test                       Quick self-test
 */

const cmd = process.argv[2];
const log = (m) => console.error(`[pi-chatgpt] ${m}`);

if (cmd === "consult") {
  const argv = process.argv.slice(3);
  const files = [];
  const words = [];
  let session = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-f" || argv[i] === "--file") files.push(argv[++i]);
    else if (argv[i] === "-s" || argv[i] === "--session") session = argv[++i] ?? "0";
    else words.push(argv[i]);
  }
  const question = words.join(" ");
  if (!question) {
    console.error("Usage: pi-chatgpt consult [-f <file>]... [-s <n>] <question>");
    process.exit(1);
  }

  let context = "";
  if (session !== null) {
    const { sessions, render, title } = await import("../src/session-log.mjs");
    const list = sessions(process.cwd());
    const file = /^\d+$/.test(session) ? list[Number(session)] : list.find((f) => f.includes(session));
    if (!file) {
      console.error(`No session "${session}" for ${process.cwd()}`);
      process.exit(1);
    }
    log(`session: ${title(file)}`);
    context = render(file);
  }

  const { consult } = await import("../src/consult.mjs");
  console.log(await consult(question, { files, context, log }));
} else if (cmd === "sessions") {
  const { sessions, title } = await import("../src/session-log.mjs");
  sessions(process.argv[3] || process.cwd())
    .slice(0, 20)
    .forEach((f, i) => console.log(`${i}\t${title(f)}`));
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
  console.error("Usage: pi-chatgpt [agent|consult|sessions|test]");
  process.exit(1);
}
