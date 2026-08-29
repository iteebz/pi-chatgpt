#!/usr/bin/env node
/**
 * query.mjs — the working prototype
 *
 * Connects to Arc (or any Chromium) via CDP, sends a prompt to ChatGPT,
 * polls the DOM for the response, returns it. This is the verified approach.
 *
 * Usage:
 *   node proto/query.mjs "your prompt here"
 *   echo "your prompt" | node proto/query.mjs
 *
 * Prereqs:
 *   - Arc/Chrome running with --remote-debugging-port=9222
 *   - Logged into ChatGPT Plus
 */

import { chromium } from "playwright-core";

const CDP_URL = "http://127.0.0.1:9222";
const CHATGPT_URL = "https://chatgpt.com/?temporary-chat=true";

const SEL = {
  composer: '[data-testid="prompt-textarea"], #prompt-textarea, [contenteditable="true"][data-lexical-editor="true"]',
  sendButton: '[data-testid="send-button"], [aria-label="Send prompt"], [aria-label="Send"]',
  stopButton: '[data-testid="stop-button"]',
  assistantTurn: [
    '[data-testid^="conversation-turn-"][data-turn="assistant"]',
    '[data-testid^="conversation-turn-"][data-message-author-role="assistant"]',
  ].join(", "),
};

async function getPrompt() {
  if (process.argv[2]) return process.argv[2];
  // Read from stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString().trim();
  if (!text) { console.error("Usage: node proto/query.mjs <prompt>"); process.exit(1); }
  return text;
}

async function query(prompt) {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes("chatgpt"));

  // Always start a fresh temporary chat
  if (!page) page = await ctx.newPage();
  await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SEL.composer, { timeout: 30000 });
  await sleep(500);

  // Type and send
  const composer = page.locator(SEL.composer).last();
  await composer.click();
  await selectAll(page);
  await page.keyboard.press("Backspace");
  await composer.fill(prompt);
  await sleep(200);

  const sendBtn = page.locator(SEL.sendButton).filter({ visible: true }).first();
  if (await sendBtn.isVisible() && await sendBtn.isEnabled()) {
    await sendBtn.click();
  } else {
    await page.keyboard.press("Enter");
  }

  // Wait for assistant turn
  await page.waitForSelector(SEL.assistantTurn, { timeout: 30000 });

  // Poll until stable
  let text = "";
  let stableCount = 0;
  const start = Date.now();
  const maxWait = 180000; // 3 minutes

  while (Date.now() - start < maxWait) {
    const streaming = await page.locator(SEL.stopButton).isVisible().catch(() => false);
    const current = await extractText(page);

    if (!streaming && current && current === text) {
      stableCount++;
      if (stableCount >= 3) break;
    } else {
      stableCount = 0;
    }
    text = current;
    await sleep(200);
  }

  await browser.close();
  return text;
}

async function extractText(page) {
  return page.evaluate((sel) => {
    const turns = document.querySelectorAll(sel);
    if (turns.length === 0) return "";
    const last = turns[turns.length - 1];
    const markdown = last.querySelector(".markdown");
    return markdown?.innerText?.trim() || last.innerText?.trim() || "";
  }, SEL.assistantTurn);
}

async function selectAll(page) {
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(mod);
  await page.keyboard.press("a");
  await page.keyboard.up(mod);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Main ---
const prompt = await getPrompt();
const start = Date.now();
const result = await query(prompt);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(result);
console.error(`\n[${elapsed}s, ${result.length} chars]`);
