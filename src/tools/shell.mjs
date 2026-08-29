/**
 * Shell execution tool.
 *
 * Prior art: Codex's shell tool, codex-chatgpt-web full harness
 * (miuuyy/codex-chatgpt-web → src/adapters/chatgpt-web/mcp-server.ts)
 */

import { execSync } from "node:child_process";

export const name = "shell";

export const description =
  "Execute a shell command on the local machine. Returns stdout and stderr. " +
  "Use for running scripts, installing packages, git operations, builds, tests, etc.";

export const schema = {
  command: { type: "string", description: "Shell command to execute" },
  cwd: {
    type: "string",
    description: "Working directory (defaults to home)",
    optional: true,
  },
  timeout_ms: {
    type: "number",
    description: "Timeout in milliseconds (default 30000)",
    optional: true,
  },
};

export function execute({ command, cwd, timeout_ms }) {
  if (!command || typeof command !== "string") {
    throw new Error("command is required");
  }
  const timeout = timeout_ms || 30_000;
  const dir = cwd || process.env.HOME || process.cwd();

  try {
    const stdout = execSync(command, {
      cwd: dir,
      timeout,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exit_code: 0, stdout: stdout || "", stderr: "" };
  } catch (err) {
    return {
      exit_code: err.status ?? 1,
      stdout: err.stdout || "",
      stderr: err.stderr || err.message || "",
    };
  }
}
