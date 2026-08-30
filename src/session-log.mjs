/**
 * Pi session transcript → readable markdown.
 *
 * A dead session's `.jsonl` is a raw event log: thinking blocks, tool calls,
 * and multi-megabyte tool outputs. What another model needs to continue the
 * work is the narrative — who asked what, what was tried, what came back — so
 * tool results are truncated hard and signatures dropped.
 *
 * Sessions live under ~/.pi/agent/sessions/<slugified-cwd>/.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SESSION_ROOT = join(homedir(), ".pi", "agent", "sessions");

/** Slug pi uses for a working directory. */
export const slug = (cwd) => `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`;

/** Session files for a cwd, newest first. */
export function sessions(cwd) {
  const dir = join(SESSION_ROOT, slug(cwd));
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") && f !== "generations.jsonl")
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
}

/** The task line pi shows in its session picker. */
export function title(path) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"session_info"')) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === "session_info" && e.name) return e.name;
    } catch {}
  }
  return "(untitled)";
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… [${s.length - n} chars elided]` : s);

const textOf = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/**
 * Render one session as markdown.
 *
 * @param {string} path session .jsonl
 * @param {{toolChars?: number, thinking?: boolean}} opts
 */
export function render(path, { toolChars = 600, thinking = false } = {}) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }

    if (e.type === "session") {
      out.push(`# pi session ${e.id}\ncwd: ${e.cwd} · started ${e.timestamp}`);
      continue;
    }
    if (e.type === "session_info" && e.name) {
      out.push(`task: ${e.name}`);
      continue;
    }
    if (e.type === "custom_message" || e.type === "user_message") {
      const t = textOf(e.content ?? e.message?.content);
      if (t) out.push(`## human\n${t}`);
      continue;
    }
    if (e.type !== "message") continue;

    const m = e.message;
    if (m.role === "user") {
      const t = textOf(m.content) || (typeof m.content === "string" ? m.content : "");
      if (t) out.push(`## human\n${t}`);
    } else if (m.role === "assistant") {
      for (const b of m.content ?? []) {
        if (b.type === "text" && b.text.trim()) out.push(`## agent\n${b.text.trim()}`);
        else if (b.type === "thinking" && thinking && b.thinking) out.push(`> ${b.thinking}`);
        else if (b.type === "toolCall")
          out.push(`### ${b.name}\n\`\`\`\n${clip(JSON.stringify(b.arguments), 400)}\n\`\`\``);
      }
    } else if (m.role === "toolResult") {
      const t = textOf(m.content);
      if (t) out.push(`\`\`\`\n${clip(t, toolChars)}\n\`\`\``);
    }
  }
  return out.join("\n\n");
}
