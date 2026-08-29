/**
 * ChatGPT browser session — multi-turn transport.
 *
 * Connects to a real Chromium over CDP (headless is captcha-blocked), reuses the
 * logged-in ChatGPT Plus session, and exposes one primitive: ask(text) -> reply.
 * Turn boundaries come from assistant turn count, not text diffing, so a reply
 * identical to the previous one still resolves.
 *
 * See docs/findings.md for why DOM polling and not network interception.
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const CDP_PORT = Number(process.env.PI_CHATGPT_CDP_PORT) || 9222;
const CDP_URL = process.env.PI_CHATGPT_CDP || `http://127.0.0.1:${CDP_PORT}`;
const CHAT_URL = "https://chatgpt.com/?temporary-chat=true";
const PROFILE_DIR = process.env.PI_CHATGPT_PROFILE || join(homedir(), ".pi-chatgpt", "chrome-profile");

const SEL = {
  composer:
    '[data-testid="prompt-textarea"], #prompt-textarea, [contenteditable="true"][data-lexical-editor="true"]',
  send: '[data-testid="send-button"], [aria-label="Send prompt"], [aria-label="Send"]',
  stop: '[data-testid="stop-button"]',
  assistant: [
    '[data-testid^="conversation-turn-"][data-turn="assistant"]',
    '[data-testid^="conversation-turn-"][data-message-author-role="assistant"]',
  ].join(", "),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Session {
  constructor({ timeoutMs = 300_000, verbose = false } = {}) {
    this.timeoutMs = timeoutMs;
    this.verbose = verbose;
  }

  async open() {
    await ensureCDP();
    this.browser = await chromium.connectOverCDP(CDP_URL);
    const ctx = this.browser.contexts()[0];
    if (!ctx) throw new Error("No browser context found");

    this.page = ctx.pages().find((p) => p.url().includes("chatgpt")) || (await ctx.newPage());
    await this.page.goto(CHAT_URL, { waitUntil: "domcontentloaded" });
    await this.page.waitForSelector(SEL.composer, { timeout: 30_000 });
    await sleep(500);
    return this;
  }

  async close() {
    await this.browser?.close();
  }

  async ask(text) {
    const before = await this.#turnCount();
    await this.#send(text);
    await this.#waitForTurn(before);
    return this.#waitStable();
  }

  async #send(text) {
    const composer = this.page.locator(SEL.composer).last();
    await composer.click();
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await this.page.keyboard.down(mod);
    await this.page.keyboard.press("a");
    await this.page.keyboard.up(mod);
    await this.page.keyboard.press("Backspace");
    await composer.fill(text);
    await sleep(200);

    const send = this.page.locator(SEL.send).filter({ visible: true }).first();
    if (await send.isVisible().catch(() => false)) await send.click();
    else await this.page.keyboard.press("Enter");
  }

  async #turnCount() {
    return this.page.evaluate((sel) => document.querySelectorAll(sel).length, SEL.assistant);
  }

  async #waitForTurn(before) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if ((await this.#turnCount()) > before) return;
      await sleep(200);
    }
    throw new Error("No new assistant turn appeared");
  }

  async #waitStable() {
    let text = "";
    let stable = 0;
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      const streaming = await this.page.locator(SEL.stop).isVisible().catch(() => false);
      const current = await this.#lastTurnText();
      if (!streaming && current && current === text) {
        if (++stable >= 3) return current;
      } else {
        stable = 0;
      }
      text = current;
      await sleep(200);
    }
    throw new Error("Response never stabilized");
  }

  /**
   * Read the last assistant turn back as markdown.
   *
   * `innerText` alone is not enough: a fenced block renders to `<pre><code>`,
   * where the fences are gone and the language survives only as a UI label. The
   * model emits `\`\`\`json {...}\`\`\`` and the DOM hands back `JSON\n{...}` —
   * which the fenced-only provider parser correctly refuses. So reconstruct the
   * fences from the code elements instead of reading the rendered surface.
   */
  async #lastTurnText() {
    return this.page.evaluate((sel) => {
      const turns = document.querySelectorAll(sel);
      const last = turns[turns.length - 1];
      if (!last) return "";
      const root = last.querySelector(".markdown") || last;

      const fence = (pre) => {
        const code = pre.querySelector("code");
        const lang = [...(code?.classList ?? [])].find((c) => c.startsWith("language-"))?.slice(9) ?? "";
        return `\`\`\`${lang}\n${(code ?? pre).textContent.trim()}\n\`\`\``;
      };

      const read = (node) => {
        if (!node.children.length) return node.innerText ?? node.textContent ?? "";
        const parts = [];
        for (const child of node.children) {
          if (child.tagName === "PRE") parts.push(fence(child));
          else if (child.querySelector("pre")) parts.push(read(child));
          else parts.push(child.innerText ?? child.textContent ?? "");
        }
        return parts.filter((p) => p.trim()).join("\n\n");
      };

      return read(root).trim();
    }, SEL.assistant);
  }
}

/** True if CDP is listening. */
async function cdpAlive() {
  try {
    const r = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Find a Chromium-family binary on macOS or Linux. */
function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Linux / PATH fallback
  for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
    try {
      const p = execSync(`which ${name}`, { encoding: "utf8" }).trim();
      if (p) return p;
    } catch {}
  }
  return null;
}

let launched = false;

/** Ensure a CDP-enabled browser is running. Launches one if needed. */
async function ensureCDP() {
  if (await cdpAlive()) return;
  if (launched) throw new Error("Launched Chrome but CDP never came up");

  const bin = findChrome();
  if (!bin) {
    throw new Error(
      "No Chrome/Chromium found. Install Google Chrome or set PI_CHATGPT_CDP to a running debugger URL.",
    );
  }

  mkdirSync(PROFILE_DIR, { recursive: true });
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    CHAT_URL,
  ];

  process.stderr.write(`[pi-chatgpt] launching Chrome with CDP on :${CDP_PORT}\n`);
  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();
  launched = true;

  // Wait for CDP to come up
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await cdpAlive()) return;
    await sleep(500);
  }
  throw new Error(`Chrome launched but CDP not responding on ${CDP_URL} after 15s`);
}
