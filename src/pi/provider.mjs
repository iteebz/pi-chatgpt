/**
 * pi's streamSimple, backed by a ChatGPT browser thread.
 *
 * pi owns the loop, the tools, and the context; this owns only the mouth. Each
 * call sends the new part of pi's context into the thread, waits for one reply,
 * and re-emits it in pi's event vocabulary.
 *
 * Three things a real API gives that a chat thread does not, and what we do:
 *   - streaming tool calls — DOM polling yields whole replies, so `toolcall_delta`
 *     fires once with the complete arguments rather than not at all.
 *   - a stop reason — ChatGPT never says why it stopped, so it is inferred from
 *     shape: a reply carrying calls is `toolUse`, one without is `stop`. `length`
 *     has no signal and is never emitted.
 *   - token accounting — estimated from characters, because pi's auto-compaction
 *     needs a number that grows, and zero would let the thread hit its own
 *     invisible ceiling with pi believing the context was empty.
 *
 * The browser is one serial resource. Every call queues behind the last.
 */

import { appendFileSync } from "node:fs";
import * as piAi from "@earendil-works/pi-ai";
import { Session, DEFAULT_THINKING } from "../browser.mjs";
import { parseReply } from "../protocol.mjs";
import { plan } from "./serialize.mjs";

// Factory on pi-ai ≥0.66, constructor before it.
const newStream =
  typeof piAi.createAssistantMessageEventStream === "function"
    ? piAi.createAssistantMessageEventStream
    : () => new piAi.AssistantMessageEventStream();

const CHARS_PER_TOKEN = 4;

let session = null;
let state = null;
let sentChars = 0;
let chain = Promise.resolve();

/** Drop the thread. The next turn opens a new chat and replays pi's history. */
export function resetThread(reason) {
  debug(`reset thread: ${reason}`);
  const closing = session;
  session = null;
  state = null;
  sentChars = 0;
  if (closing) chain = chain.then(() => closing.close().catch(() => {}));
}

export function streamChatGptWeb(model, context, options) {
  const stream = newStream();
  chain = chain.then(
    () => turn(model, context, options, stream),
    () => turn(model, context, options, stream),
  );
  return stream;
}

async function turn(model, context, options, stream) {
  const message = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "pending",
    timestamp: Date.now(),
  };
  stream.push({ type: "start", partial: message });

  try {
    const step = plan(state, context);
    if (step.mode === "rebuild" && session) {
      await session.close().catch(() => {});
      session = null;
      sentChars = 0;
    }
    if (!session) session = await new Session({ thinking: DEFAULT_THINKING }).open();

    debug(`${step.mode}: sending ${step.text.length} chars`);
    if (aborted(options)) return abort(stream, message);

    trace(`>>> ${step.mode}\n${step.text}`);
    const reply = await session.ask(step.text);
    trace(`<<< reply\n${reply}`);
    // Commit only after the reply lands: a thread that never received the text
    // must not be recorded as having seen it.
    state = step.state;
    sentChars += step.text.length;

    if (aborted(options)) return abort(stream, message);

    emit(stream, message, reply);
    sentChars += reply.length;
  } catch (err) {
    debug(`turn failed: ${err?.message}`);
    // The thread's state is unknown after a failure — a half-sent prompt or a
    // dead tab would poison every later diff.
    resetThread("turn failed");
    message.stopReason = "error";
    message.errorMessage = err?.message ?? String(err);
    stream.push({ type: "error", reason: "error", error: message });
  }
}

function emit(stream, message, reply) {
  const { text, calls } = parseReply(reply);

  if (text) {
    const index = message.content.length;
    message.content.push({ type: "text", text });
    stream.push({ type: "text_start", contentIndex: index, partial: message });
    stream.push({ type: "text_delta", contentIndex: index, delta: text, partial: message });
    stream.push({ type: "text_end", contentIndex: index, content: text, partial: message });
  }

  for (const [i, call] of calls.entries()) {
    const index = message.content.length;
    const toolCall = {
      type: "toolCall",
      id: `chatgpt_${Date.now().toString(36)}_${i}`,
      name: call.name,
      arguments: call.args,
    };
    message.content.push(toolCall);
    stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
    stream.push({
      type: "toolcall_delta",
      contentIndex: index,
      delta: JSON.stringify(call.args),
      partial: message,
    });
    stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: message });
  }

  message.usage.input = Math.ceil(sentChars / CHARS_PER_TOKEN);
  message.usage.output = Math.ceil(reply.length / CHARS_PER_TOKEN);
  message.usage.totalTokens = message.usage.input + message.usage.output;
  message.stopReason = calls.length ? "toolUse" : "stop";
  debug(`reply: ${text.length} chars text, ${calls.length} calls, est ${message.usage.totalTokens} tokens`);
  stream.push({ type: "done", reason: message.stopReason, message });
}

function aborted(options) {
  return options?.signal?.aborted === true;
}

function abort(stream, message) {
  resetThread("aborted mid-turn");
  message.stopReason = "aborted";
  message.errorMessage = "aborted";
  stream.push({ type: "error", reason: "aborted", error: message });
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function debug(text) {
  if (process.env.PI_CHATGPT_DEBUG) process.stderr.write(`[pi-chatgpt] ${text}\n`);
}

/** Verbatim thread transcript. The only way to see what the model actually saw
 *  and said — pi's TUI shows the parsed result, which is where prompt bugs hide. */
function trace(text) {
  if (process.env.PI_CHATGPT_TRACE) appendFileSync(process.env.PI_CHATGPT_TRACE, `\n${text}\n`);
}
