#!/usr/bin/env node
/**
 * Proto 1: Network interception
 *
 * Uses CDP Fetch domain to intercept the SSE stream from backend-api/conversation.
 * This captures the full streaming body, unlike route.fetch() which can truncate.
 */

import { chromium } from "playwright-core";
import { getPrompt, sleep, SEL } from "./shared.mjs";

const prompt = getPrompt();

/** Extract text deltas from ChatGPT's delta encoding v1 SSE stream. */
function parseSSE(body) {
  let text = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (raw === "[DONE]" || raw.startsWith('"')) continue;
    try {
      const d = JSON.parse(raw);
      if (d.o === "append" && d.p?.includes("/content/parts/") && typeof d.v === "string") text += d.v;
      if (d.o === "patch" && Array.isArray(d.v)) {
        for (const patch of d.v) {
          if (patch.o === "append" && patch.p?.includes("/content/parts/") && typeof patch.v === "string") text += patch.v;
        }
      }
    } catch {}
  }
  return text;
}

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes("chatgpt"));
  if (!page) page = await ctx.newPage();

  await page.goto("https://chatgpt.com/?temporary-chat=true", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SEL.composer, { timeout: 30000 });
  await sleep(1000);

  // Use page.on('response') — it waits for the full body including SSE streams
  const responsePromise = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve("(timeout)"), 120000);

    const handler = async (response) => {
      const url = response.url();
      if (!url.includes("backend-api") || !url.includes("conversation")) return;
      // Skip non-SSE endpoints (conversations list, autocompletions, etc)
      if (url.includes("conversations?") || url.includes("autocompletions")) return;
      if (response.status() !== 200) return;

      try {
        // response.text() waits for the full stream to complete
        const body = await response.text();
        const text = parseSSE(body);
        if (text.length > 0) {
          console.log(`\nIntercepted: ${body.length} bytes → ${text.length} chars`);
          clearTimeout(timeout);
          page.off("response", handler);
          resolve(text);
        }
      } catch (err) {
        // Response body may not be available for some responses
      }
    };

    page.on("response", handler);
  });

  // Send the prompt
  const composer = page.locator(SEL.composer).last();
  await composer.click();
  await page.keyboard.down("Meta");
  await page.keyboard.press("a");
  await page.keyboard.up("Meta");
  await page.keyboard.press("Backspace");
  await composer.fill(prompt);
  await sleep(300);
  const sendBtn = page.locator(SEL.sendButton).filter({ visible: true }).first();
  await sendBtn.waitFor({ state: "visible", timeout: 5000 });
  await sendBtn.click();
  console.log(`Sent: "${prompt.slice(0, 60)}${prompt.length > 60 ? "..." : ""}"`);

  const result = await responsePromise;

  console.log("\n--- RESULT ---");
  console.log(result);
  console.log("--- END ---");
  console.log(`Length: ${result.length} chars`);

  await browser.close();
}

run().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
