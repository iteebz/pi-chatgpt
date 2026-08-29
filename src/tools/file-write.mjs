/**
 * File write tool.
 *
 * Prior art: Codex apply_patch / file write tools
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export const name = "file_write";

export const description =
  "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. " +
  "Automatically creates parent directories.";

export const schema = {
  path: { type: "string", description: "Absolute or relative path to write" },
  content: { type: "string", description: "Content to write to the file" },
};

export function execute({ path: filePath, content }) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("path is required");
  }
  if (content === undefined || content === null) {
    throw new Error("content is required");
  }
  const resolved = resolve(filePath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content, "utf-8");

  return { path: resolved, bytes: Buffer.byteLength(content, "utf-8") };
}
