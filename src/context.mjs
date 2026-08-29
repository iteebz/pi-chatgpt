/**
 * Environment context for ChatGPT.
 *
 * Exposes an MCP resource that orients ChatGPT to the user's machine:
 * OS, shell, cwd, git repo state. Without this, ChatGPT gets raw tools
 * with no idea what it's working on.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Gather environment snapshot. */
export function getContext(cwd) {
  const dir = cwd || process.env.HOME || process.cwd();
  const ctx = {
    os: process.platform,
    arch: process.arch,
    shell: process.env.SHELL || "unknown",
    home: process.env.HOME || "unknown",
    cwd: dir,
    node_version: process.version,
  };

  // Git info if in a repo
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const status = execSync("git status --short", {
      cwd: dir, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    ctx.git = { branch, dirty_files: status ? status.split("\n").length : 0 };
  } catch {
    ctx.git = null;
  }

  // Check for common project markers
  const markers = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Makefile", "justfile"];
  ctx.project_markers = markers.filter((m) => existsSync(resolve(dir, m)));

  return ctx;
}

/** Format context as a system-prompt-style string. */
export function formatContext(cwd) {
  const ctx = getContext(cwd);
  const lines = [
    `You are operating on the user's local machine via pi-chatgpt MCP tools.`,
    ``,
    `Environment:`,
    `  OS: ${ctx.os} (${ctx.arch})`,
    `  Shell: ${ctx.shell}`,
    `  Home: ${ctx.home}`,
    `  CWD: ${ctx.cwd}`,
    `  Node: ${ctx.node_version}`,
  ];
  if (ctx.git) {
    lines.push(`  Git branch: ${ctx.git.branch} (${ctx.git.dirty_files} dirty files)`);
  }
  if (ctx.project_markers.length) {
    lines.push(`  Project: ${ctx.project_markers.join(", ")}`);
  }
  lines.push(
    ``,
    `Available tools: shell, file_read, file_write, grep, git`,
    ``,
    `Guidelines:`,
    `- Read before writing. Understand the codebase before changing it.`,
    `- Use grep to find code, git for version control.`,
    `- Prefer small, focused changes. Commit frequently.`,
    `- Show your work: run tests, check output, verify results.`,
  );
  return lines.join("\n");
}
