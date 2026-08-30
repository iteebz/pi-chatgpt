/**
 * Consult mode — ask ChatGPT, don't arm it.
 *
 * The agent loop's inverse: no tools, no protocol. A personalized temporary
 * chat reads your memory and custom instructions but writes nothing back and
 * leaves no history, so a transcript drop costs no context pollution.
 *
 * Context larger than one message arrives as a drop chain: N silent chunks
 * acknowledged with a token, then the question. Chunks run at Instant thinking
 * because acknowledging is not reasoning; the question runs at High.
 *
 * `consult` is `send` against a throwaway channel: open, ask, close.
 *
 * See docs/architecture.md for where this sits relative to the agent CLI.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Session, DEFAULT_THINKING } from "./browser.mjs";

/** Composer ceiling. Well under the web limit — chunks are cheap, retries aren't. */
const CHUNK = 12_000;
const ACK = "OK";

/** Read files into labelled blocks. */
export const attach = (files) =>
  files.map((path) => `--- ${basename(path)} ---\n${readFileSync(path, "utf8").trim()}`).join("\n\n");

/** Split on paragraph boundaries, never mid-line. */
export function chunk(text, size = CHUNK) {
  const out = [];
  let buf = "";
  for (const para of text.split("\n\n")) {
    if (buf && buf.length + para.length + 2 > size) {
      out.push(buf);
      buf = "";
    }
    buf = buf ? `${buf}\n\n${para}` : para;
    while (buf.length > size) {
      out.push(buf.slice(0, size));
      buf = buf.slice(size);
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * One consult. Drops context in order, then asks.
 *
 * @param {string} question
 * @param {{files?: string[], context?: string, thinking?: string, log?: (m: string) => void}} opts
 * @returns {Promise<string>} the final reply
 */
export async function consult(question, opts = {}) {
  const session = new Session({ thinking: opts.thinking ?? DEFAULT_THINKING, personalize: true });
  await session.open();
  try {
    return await turn(session, question, opts);
  } finally {
    await session.close();
  }
}

/**
 * One turn on an already-open session: drop any context, then ask.
 *
 * @param {Session} session
 * @param {string} question
 * @param {{files?: string[], context?: string, thinking?: string, log?: (m: string) => void}} opts
 * @returns {Promise<string>} the reply
 */
export async function turn(session, question, { files = [], context = "", thinking = DEFAULT_THINKING, log = () => {} } = {}) {
  const body = [context, files.length ? attach(files) : ""].filter(Boolean).join("\n\n");
  const parts = body ? chunk(body) : [];

  if (parts.length <= 1) {
    return session.ask(parts.length ? `${parts[0]}\n\n---\n\n${question}` : question);
  }

  await session.setThinking("Instant");
  for (const [i, part] of parts.entries()) {
    log(`chunk ${i + 1}/${parts.length} (${part.length} chars)`);
    await session.ask(
      `Context ${i + 1} of ${parts.length}. Do not answer or comment yet — reply with exactly "${ACK}". The question comes last.\n\n${part}`,
    );
  }
  log(`asking (thinking: ${thinking})`);
  await session.setThinking(thinking);
  return session.ask(`All ${parts.length} parts delivered. Now:\n\n${question}`);
}
