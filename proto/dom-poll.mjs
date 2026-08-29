#!/usr/bin/env node
/**
 * Proto 2: DOM polling
 *
 * Polls the assistant turn's DOM for text content.
 * What codex-chatgpt-web and agentify-desktop both do (simplified).
 */

import { connect, sendPrompt, getPrompt, sleep, SEL } from "./shared.mjs";

const prompt = getPrompt();

async function run() {
  const { browser, page } = await connect();

  // Fresh temporary chat
  await page.goto("https://chatgpt.com/?temporary-chat=true", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(SEL.composer, { timeout: 30000 });
  await sleep(1000);

  await sendPrompt(page, prompt);

  // Wait for assistant turn to appear
  console.log("Waiting for response...");
  await page.waitForSelector(SEL.assistantTurn, { timeout: 30000 });

  // Poll until response stabilizes
  let previousText = "";
  let stableCount = 0;
  let lastText = "";
  const startTime = Date.now();
  const maxWait = 120000;

  while (Date.now() - startTime < maxWait) {
    // Check if stop button is still visible (streaming)
    const streaming = await page.locator(SEL.stopButton).isVisible().catch(() => false);

    // Get all assistant turn text
    const text = await page.evaluate((sel) => {
      const turns = document.querySelectorAll(sel);
      if (turns.length === 0) return "";
      const last = turns[turns.length - 1];
      const markdown = last.querySelector(".markdown");
      return markdown?.innerText?.trim() || last.innerText?.trim() || "";
    }, SEL.assistantTurn);

    // Stream deltas to stdout
    if (text.length > lastText.length) {
      const delta = text.slice(lastText.length);
      process.stdout.write(delta);
      lastText = text;
    }

    if (!streaming && text && text === previousText) {
      stableCount++;
      if (stableCount >= 3) break; // Stable for 3 polls = done
    } else {
      stableCount = 0;
    }
    previousText = text;
    await sleep(200);
  }

  console.log("\n\n--- RESULT ---");
  console.log(lastText);
  console.log("--- END ---");
  console.log(`\nLength: ${lastText.length} chars`);
  console.log(`Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  await browser.close();
}

run().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
