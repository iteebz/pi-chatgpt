/**
 * Consult mode — ask ChatGPT, don't arm it.
 *
 * The agent loop's inverse: no tools, no protocol, one turn. A personalized
 * temporary chat reads your memory and custom instructions but writes nothing
 * back and leaves no history, so a transcript drop costs no context pollution.
 *
 * See docs/architecture.md for where this sits relative to the agent CLI.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Session, DEFAULT_THINKING } from "./browser.mjs";

/** Compose one prompt from attached files plus the question. */
export function compose(question, files = []) {
  const blocks = files.map((path) => {
    const body = readFileSync(path, "utf8").trim();
    return `--- ${basename(path)} ---\n${body}`;
  });
  return blocks.length ? `${blocks.join("\n\n")}\n\n---\n\n${question}` : question;
}

/** One-shot ask against the logged-in session. Returns the reply text. */
export async function consult(question, { files = [], thinking = DEFAULT_THINKING } = {}) {
  const prompt = compose(question, files);
  const session = new Session({ thinking, personalize: true });
  await session.open();
  try {
    return await session.ask(prompt);
  } finally {
    await session.close();
  }
}
