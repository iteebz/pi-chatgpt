/**
 * pi extension entry: ChatGPT web registered as a model provider.
 *
 * The premier surface — pi owns the loop, tools, context, skills, and TUI, and
 * this supplies the model. Everything that makes it work lives in provider.mjs
 * (the turn) and serialize.mjs (the diff). See docs/architecture.md.
 */

import { resetThread, streamChatGptWeb } from "./provider.mjs";

const PROVIDER_ID = "chatgpt-web";

// The thread's real ceiling is unknown and smaller than the API's; usage is
// estimated from characters, so this is the number pi compacts against rather
// than a served fact. Lower it if a long session starts losing the plot.
const CONTEXT_WINDOW = Number(process.env.PI_CHATGPT_CONTEXT_WINDOW) || 128_000;

const MODELS = [
  {
    id: "chatgpt-web",
    name: "ChatGPT (web)",
    reasoning: false,
    input: ["text"],
    maxTokens: 32_000,
    contextWindow: CONTEXT_WINDOW,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
];

// Subagent extensions reload this module; without the guard their registration
// overwrites the parent's streamSimple and the parent's next turn runs against
// a thread it does not own.
const ACTIVE = Symbol.for("chatgpt-web:activeStreamSimple");

export default function (pi) {
  pi.on("session_start", (event) => resetThread(`session_start:${event.reason}`));
  pi.on("session_shutdown", () => resetThread("session_shutdown"));

  if (globalThis[ACTIVE]) return;
  globalThis[ACTIVE] = streamChatGptWeb;

  pi.registerProvider(PROVIDER_ID, {
    name: "ChatGPT (web)",
    baseUrl: "chatgpt-web",
    apiKey: "not-used",
    api: "chatgpt-web",
    models: MODELS,
    streamSimple: streamChatGptWeb,
  });
}
