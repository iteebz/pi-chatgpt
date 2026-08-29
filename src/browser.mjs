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

import { chromium } from "playwright-core";

const CDP_URL = process.env.PI_CHATGPT_CDP || "http://127.0.0.1:9222";
const CHAT_URL = "https://chatgpt.com/?temporary-chat=true";

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
    this.browser = await chromium.connectOverCDP(CDP_URL);
    const ctx = this.browser.contexts()[0];
    if (!ctx) throw new Error("No browser context — is the browser running with --remote-debugging-port?");

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

  async #lastTurnText() {
    return this.page.evaluate((sel) => {
      const turns = document.querySelectorAll(sel);
      const last = turns[turns.length - 1];
      if (!last) return "";
      const md = last.querySelector(".markdown");
      return (md?.innerText || last.innerText || "").trim();
    }, SEL.assistant);
  }
}
