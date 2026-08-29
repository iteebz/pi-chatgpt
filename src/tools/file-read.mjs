/**
 * File read tool.
 *
 * Prior art: Codex file read, agentify-sh/desktop context packing
 */

import { readFileSync, statSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const name = "file_read";

export const description =
  "Read a file or list a directory. Returns file contents or directory listing. " +
  "For text files, returns the content. For directories, returns the file list.";

export const schema = {
  path: { type: "string", description: "Absolute or relative path to read" },
  max_chars: {
    type: "number",
    description: "Maximum characters to return (default 100000)",
    optional: true,
  },
};

export function execute({ path: filePath, max_chars }) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("path is required");
  }
  const resolved = resolve(filePath);
  const maxChars = max_chars || 100_000;

  const stat = statSync(resolved);

  if (stat.isDirectory()) {
    const entries = readdirSync(resolved, { withFileTypes: true });
    const listing = entries.map((e) => {
      const suffix = e.isDirectory() ? "/" : "";
      return `${e.name}${suffix}`;
    });
    return { type: "directory", path: resolved, entries: listing };
  }

  if (stat.size > 5 * 1024 * 1024) {
    return {
      type: "file",
      path: resolved,
      error: `File too large: ${stat.size} bytes`,
    };
  }

  let content = readFileSync(resolved, "utf-8");
  const truncated = content.length > maxChars;
  if (truncated) content = content.slice(0, maxChars);

  return { type: "file", path: resolved, content, truncated };
}
