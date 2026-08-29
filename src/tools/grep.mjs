/**
 * Recursive grep tool. Faster than shelling out for common search patterns.
 */

import { execSync } from "node:child_process";

export const name = "grep";

export const description =
  "Search file contents recursively using grep. Returns matching lines with " +
  "file paths and line numbers. Useful for finding code, references, or patterns.";

export const schema = {
  pattern: { type: "string", description: "Search pattern (basic regex)" },
  path: {
    type: "string",
    description: "Directory or file to search (defaults to cwd)",
    optional: true,
  },
  include: {
    type: "string",
    description: "Glob pattern for files to include, e.g. '*.py'",
    optional: true,
  },
  max_results: {
    type: "number",
    description: "Maximum matches to return (default 100)",
    optional: true,
  },
};

export function execute({ pattern, path, include, max_results }) {
  if (!pattern || typeof pattern !== "string") {
    throw new Error("pattern is required");
  }
  const dir = path || process.cwd();
  const limit = max_results || 100;

  const args = ["grep", "-rn", "--color=never"];
  if (include) args.push(`--include=${include}`);
  args.push("--", pattern, dir);

  try {
    const stdout = execSync(args.join(" "), {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = stdout.split("\n").filter(Boolean);
    const truncated = lines.length > limit;
    return {
      matches: lines.slice(0, limit),
      total: lines.length,
      truncated,
    };
  } catch (err) {
    if (err.status === 1) return { matches: [], total: 0, truncated: false };
    return { error: err.stderr || err.message };
  }
}
