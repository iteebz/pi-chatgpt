/**
 * The one invariant: free ChatGPT only.
 *
 * No OpenAI API key. No Codex quota. No metered path of any kind. This test
 * fails the build if a credential, a paid endpoint, or a tunnel dependency
 * enters the source — because the whole project is worthless the moment
 * inference starts costing something.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const FORBIDDEN = [
  [/OPENAI_API_KEY/i, "OpenAI API key — metered"],
  [/CONTROL_PLANE_API_KEY/i, "tunnel runtime key — a credential we do not need"],
  [/api\.openai\.com/i, "OpenAI API endpoint — metered per token"],
  [/backend-api\/codex/i, "Codex backend — depletes Codex limits"],
  [/chatgpt\.com\/backend-api\/(?!conversation)/i, "non-conversation backend API"],
  [/tunnel-client/i, "OpenAI tunnel — requires a runtime API key"],
  [/@anthropic-ai|ANTHROPIC_API_KEY/i, "another paid provider"],
];

function sources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, acc);
    else if (/\.(mjs|js|json)$/.test(entry) && entry !== "package-lock.json") acc.push(path);
  }
  return acc;
}

test("no credential, paid endpoint, or tunnel dependency in shipped source", () => {
  const files = [...sources(join(ROOT, "src")), ...sources(join(ROOT, "bin")), join(ROOT, "package.json")];
  const violations = [];

  for (const file of files) {
    const text = readFileSync(file, "utf-8");
    for (const [pattern, why] of FORBIDDEN) {
      if (pattern.test(text)) violations.push(`${file.slice(ROOT.length + 1)}: ${why}`);
    }
  }

  assert.deepEqual(violations, [], `free-ChatGPT invariant broken:\n${violations.join("\n")}`);
});

test("the only network dependency is a browser we attach to", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  assert.deepEqual(deps.sort(), ["playwright-core"], "new dependency — confirm it carries no metered path");
});
