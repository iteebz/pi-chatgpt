/**
 * Git tool. Status, diff, log, and common operations without
 * ChatGPT needing to remember git CLI flags.
 */

import { execSync } from "node:child_process";

export const name = "git";

export const description =
  "Run git commands in a repository. Supports status, diff, log, branch, " +
  "add, commit, and arbitrary git subcommands. Returns stdout/stderr.";

export const schema = {
  subcommand: {
    type: "string",
    description:
      "Git subcommand and arguments, e.g. 'status', 'diff --staged', " +
      "'log --oneline -10', 'add .', 'commit -m \"msg\"'",
  },
  cwd: {
    type: "string",
    description: "Repository path (defaults to home directory)",
    optional: true,
  },
};

export function execute({ subcommand, cwd }) {
  if (!subcommand || typeof subcommand !== "string") {
    throw new Error("subcommand is required");
  }
  const dir = cwd || process.env.HOME || process.cwd();
  const cmd = `git ${subcommand}`;

  try {
    const stdout = execSync(cmd, {
      cwd: dir,
      timeout: 15_000,
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
