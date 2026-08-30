/**
 * Channels — a conversation with Kit held open across CLI invocations.
 *
 * `consult` is one question with no memory of the last one. A channel is the
 * dialectic: open once, send many, close when done. The browser tab is the
 * entire store — no daemon, no state file, nothing to garbage collect. Close
 * the tab or quit the browser and the channel is gone, which is correct for a
 * conversation that was never meant to persist.
 */

import { Session, channels, closeChannel as close } from "./browser.mjs";
import { turn } from "./consult.mjs";

export { channels, close };

/** Attach to a named channel, opening it if the tab is gone. */
const connect = async (name, thinking) => {
  const session = new Session({ channel: name, personalize: true, thinking });
  await session.open();
  return session;
};

/** Start a channel. Returns whether a new conversation was created. */
export async function open(name, { thinking } = {}) {
  const session = await connect(name, thinking);
  const { fresh } = session;
  await session.close();
  return fresh;
}

/**
 * Send one turn. Opens the channel if it isn't already up.
 *
 * @param {string} name
 * @param {string} message
 * @param {{files?: string[], context?: string, thinking?: string, log?: (m: string) => void}} opts
 */
export async function send(name, message, opts = {}) {
  const session = await connect(name, opts.thinking);
  try {
    if (session.fresh) opts.log?.(`opened channel "${name}"`);
    return await turn(session, message, opts);
  } finally {
    await session.close();
  }
}
