#!/usr/bin/env node

/**
 * pi-chatgpt CLI.
 *
 * One question:      pi-chatgpt consult [-f file] [-s n] <question>
 * A conversation:    pi-chatgpt open <name> · send <name> <msg> · channels · close <name>
 * ChatGPT drives:    pi-chatgpt agent <task>
 */

const [, , cmd, ...argv] = process.argv;
const log = (m) => console.error(`[pi-chatgpt] ${m}`);

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

/** Shared context flags: -f <file> (repeatable), -s <session>, rest is prose. */
function parse(args) {
  const files = [];
  const words = [];
  let session = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-f" || args[i] === "--file") files.push(args[++i]);
    else if (args[i] === "-s" || args[i] === "--session") session = args[++i] ?? "0";
    else words.push(args[i]);
  }
  return { files, session, text: words.join(" ") };
}

/** Render a pi session to markdown, chosen by index or name fragment. */
async function sessionContext(ref) {
  const { sessions, render, title } = await import("../src/session-log.mjs");
  const list = sessions(process.cwd());
  const file = /^\d+$/.test(ref) ? list[Number(ref)] : list.find((f) => f.includes(ref));
  if (!file) die(`No session "${ref}" for ${process.cwd()}`);
  log(`session: ${title(file)}`);
  return render(file);
}

if (cmd === "consult") {
  const { files, session, text } = parse(argv);
  if (!text) die("Usage: pi-chatgpt consult [-f <file>]... [-s <n>] <question>");
  const context = session !== null ? await sessionContext(session) : "";
  const { consult } = await import("../src/consult.mjs");
  console.log(await consult(text, { files, context, log }));
} else if (cmd === "open") {
  const name = argv[0];
  if (!name) die("Usage: pi-chatgpt open <name>");
  const { open } = await import("../src/channel.mjs");
  log((await open(name)) ? `opened channel "${name}"` : `channel "${name}" already open`);
} else if (cmd === "send") {
  const [name, ...rest] = argv;
  const { files, session, text } = parse(rest);
  if (!name || !text) die("Usage: pi-chatgpt send <name> [-f <file>]... [-s <n>] <message>");
  const context = session !== null ? await sessionContext(session) : "";
  const { send } = await import("../src/channel.mjs");
  console.log(await send(name, text, { files, context, log }));
} else if (cmd === "channels") {
  const { channels } = await import("../src/channel.mjs");
  const open = await channels();
  console.log(open.length ? open.join("\n") : "(none open)");
} else if (cmd === "close") {
  const name = argv[0];
  if (!name) die("Usage: pi-chatgpt close <name>");
  const { close } = await import("../src/channel.mjs");
  log((await close(name)) ? `closed "${name}"` : `no channel "${name}"`);
} else if (cmd === "sessions") {
  const { sessions, title } = await import("../src/session-log.mjs");
  sessions(argv[0] || process.cwd())
    .slice(0, 20)
    .forEach((f, i) => console.log(`${i}\t${title(f)}`));
} else if (cmd === "agent") {
  const task = argv.join(" ");
  if (!task) die("Usage: pi-chatgpt agent <task>");
  const { run } = await import("../src/agent.mjs");
  const result = await run(task, { log: (m) => console.error(m) });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "done" ? 0 : 1);
} else if (cmd === "test") {
  const { tools } = await import("../src/tools/index.mjs");
  const result = tools.get("shell").execute({ command: "echo pi-chatgpt-ok" });
  if (result.exit_code !== 0 || !result.stdout.includes("pi-chatgpt-ok")) die("✗ shell tool failed");
  console.log(`✓ shell tool works · ${tools.size} tools: ${[...tools.keys()].join(", ")}`);
} else {
  die(`Unknown command: ${cmd}\nUsage: pi-chatgpt [consult|open|send|channels|close|sessions|agent|test]`);
}
