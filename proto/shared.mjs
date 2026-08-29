/**
 * Shared browser connection and prompt submission for all prototypes.
 *
 * Connects to an existing Chrome via CDP, navigates to ChatGPT temporary chat,
 * types a prompt into the composer, and clicks send.
 */

import { chromium } from "playwright-core";

const CDP_URL = "http://127.0.0.1:9222";
const CHATGPT_URL = "https://chatgpt.com/?temporary-chat=true";

// ChatGPT DOM selectors (from codex-chatgpt-web reference)
export const SEL = {
  composer: [
    '[data-testid="prompt-textarea"]',
    "#prompt-textarea",
    '[contenteditable="true"][data-lexical-editor="true"]',
  ].join(", "),
  sendButton: '[data-testid="send-button"], [aria-label="Send prompt"], [aria-label="Send"]',
  stopButton: '[data-testid="stop-button"]',
  assistantTurn: [
    '[data-testid^="conversation-turn-"][data-turn="assistant"]',
    '[data-testid^="conversation-turn-"][data-message-author-role="assistant"]',
  ].join(", "),
  copyButton: 'button[data-testid="copy-turn-action-button"]',
};

/** Connect to existing Chrome via CDP, return { browser, page } */
export async function connect() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error("No browser contexts found");

  // Find existing ChatGPT tab or create new one
  const ctx = contexts[0];
  let page = ctx.pages().find(p => p.url().includes("chatgpt.com"));

  if (!page) {
    page = await ctx.newPage();
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(SEL.composer, { timeout: 30000 });
    console.log("Opened new ChatGPT tab");
  } else if (!page.url().includes("temporary-chat")) {
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(SEL.composer, { timeout: 30000 });
    console.log("Navigated to temporary chat");
  } else {
    console.log("Reusing existing ChatGPT tab:", page.url());
  }

  return { browser, page };
}

/** Type prompt into composer and click send. */
export async function sendPrompt(page, prompt) {
  const composer = page.locator(SEL.composer).last();
  await composer.waitFor({ state: "visible", timeout: 10000 });

  // Clear any existing text
  await composer.click();
  await page.keyboard.down("Meta");
  await page.keyboard.press("a");
  await page.keyboard.up("Meta");
  await page.keyboard.press("Backspace");

  // Type the prompt
  await composer.fill(prompt);
  // Small delay for ChatGPT to register
  await sleep(300);

  // Click send
  const sendBtn = page.locator(SEL.sendButton).filter({ visible: true }).first();
  await sendBtn.waitFor({ state: "visible", timeout: 5000 });
  if (await sendBtn.isEnabled()) {
    await sendBtn.click();
  } else {
    // Fallback: press Enter
    await page.keyboard.press("Enter");
  }

  console.log(`Sent: "${prompt.slice(0, 60)}${prompt.length > 60 ? "..." : ""}"`);
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function getPrompt() {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error("Usage: node proto/<script>.mjs <prompt>");
    process.exit(1);
  }
  return prompt;
}
