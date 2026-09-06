/**
 * ChatGPT browser session — multi-turn transport.
 *
 * Connects to a real Chromium over CDP (headless is captcha-blocked), reuses the
 * logged-in ChatGPT Plus session, and exposes one primitive: ask(text) -> reply.
 * Turn boundaries come from assistant turn count, not text diffing, so a reply
 * identical to the previous one still resolves.
 *
 * A named session is a *channel*: the tab stays open between CLI invocations and
 * holds all the state, so there is no daemon and nothing to serialize. Channels
 * are found by a sessionStorage tag on the tab, which dies with it.
 *
 * See docs/findings.md for why DOM polling and not network interception.
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const CDP_PORT = Number(process.env.PI_CHATGPT_CDP_PORT) || 9222;
const CDP_URL = process.env.PI_CHATGPT_CDP || `http://127.0.0.1:${CDP_PORT}`;
const CHAT_URL = "https://chatgpt.com/?temporary-chat=true";
const PROFILE_DIR = process.env.PI_CHATGPT_PROFILE || join(homedir(), ".pi-chatgpt", "chrome-profile");
/** @type {"Instant"|"Medium"|"High"} */
export const DEFAULT_THINKING = process.env.PI_CHATGPT_THINKING || "High";

const SEL = {
  composer:
    '[data-testid="prompt-textarea"], #prompt-textarea, [contenteditable="true"][data-lexical-editor="true"]',
  send: '[data-testid="send-button"], [aria-label="Send prompt"], [aria-label="Send"]',
  stop: '[data-testid="stop-button"]',
  assistant: [
    '[data-testid^="conversation-turn-"][data-turn="assistant"]',
    '[data-testid^="conversation-turn-"][data-message-author-role="assistant"]',
  ].join(", "),
  thinkingPill: 'button.__composer-pill',
  sliderControl: '.d1BZWq_SliderControl',
};

/** Temporary chats start unpersonalized: no memory, no custom instructions.
 *  Personalized reads memory but never writes it — the consult mode's whole
 *  point. The choice is locked once the first message is sent. */
const PERSONALIZE_PILL = "Unpersonalized";
const PERSONALIZE_ITEM = "Personalized";

const THINKING_LEVELS = ["Instant", "Medium", "High"];
const TAG = "pi-chatgpt-channel";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a callback over the tagged channel tabs, then disconnect. */
async function withChannelTabs(fn) {
  await ensureCDP();
  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const pages = (browser.contexts()[0]?.pages() ?? []).filter((p) => p.url().includes("chatgpt"));
    const named = await Promise.all(
      pages.map(async (page) => ({
        page,
        name: await page.evaluate((t) => sessionStorage.getItem(t), TAG).catch(() => null),
      })),
    );
    return await fn(named.filter((t) => t.name));
  } finally {
    await browser.close();
  }
}

/** Names of the channels currently open. */
export const channels = () => withChannelTabs((tabs) => tabs.map((t) => t.name));

/** Close a channel's tab. Returns false if it wasn't open. */
export const closeChannel = (name) =>
  withChannelTabs(async (tabs) => {
    const hit = tabs.find((t) => t.name === name);
    if (!hit) return false;
    await hit.page.close().catch(() => {});
    return true;
  });

export class Session {
  constructor({ timeoutMs = 300_000, verbose = false, thinking = null, personalize = false, channel = null } = {}) {
    this.timeoutMs = timeoutMs;
    this.verbose = verbose;
    /** @type {"Instant"|"Medium"|"High"|null} */
    this.thinking = thinking;
    this.personalize = personalize;
    /** @type {string|null} name of a tab to reattach to or create */
    this.channel = channel;
    /** true when this call created the conversation rather than reattaching */
    this.fresh = false;
  }

  /** Attach to this channel's tab, or start a conversation if there isn't one. */
  async open() {
    await ensureCDP();
    this.browser = await chromium.connectOverCDP(CDP_URL);
    const ctx = await this.#context();

    if (this.channel) this.page = await this.#findTagged(ctx);
    if (this.page) return this;

    // Always a fresh tab. Borrowing an idle one lets two concurrent sessions
    // share a conversation and read each other's replies as their own turn.
    this.page = await ctx.newPage();
    await this.page.goto(CHAT_URL, { waitUntil: "domcontentloaded" });
    await this.#waitComposer();
    await sleep(500);
    if (this.channel) await this.page.evaluate(([t, n]) => sessionStorage.setItem(t, n), [TAG, this.channel]);
    if (this.personalize) await this.#setPersonalized();
    if (this.thinking) await this.#setThinking(this.thinking);
    this.fresh = true;
    return this;
  }

  /** A just-relaunched browser can report zero contexts for a beat. */
  async #context() {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const ctx = this.browser.contexts()[0];
      if (ctx) return ctx;
      await sleep(250);
    }
    throw new Error("No browser context found over CDP");
  }

  /** The composer is the proof we are logged in and past any challenge.
   *  Without this, a login wall surfaces as a bare selector timeout. */
  async #waitComposer() {
    try {
      await this.page.waitForSelector(SEL.composer, { timeout: 45_000 });
    } catch {
      const url = this.page.url();
      if (/auth|login/i.test(url)) {
        throw new Error(`ChatGPT is not logged in (${url}). Sign in to chatgpt.com in your browser.`);
      }
      throw new Error(`ChatGPT composer never appeared at ${url} \u2014 login wall or bot challenge.`);
    }
  }

  async #findTagged(ctx) {
    for (const p of ctx.pages()) {
      if (!p.url().includes("chatgpt")) continue;
      const name = await p.evaluate((t) => sessionStorage.getItem(t), TAG).catch(() => null);
      if (name === this.channel) return p;
    }
    return null;
  }

  /** Drop the CDP connection. The tab — and the conversation — survive. */
  async close() {
    await this.browser?.close();
  }

  /** End the conversation for good. */
  async end() {
    await this.page?.close().catch(() => {});
    await this.close();
  }

  /** Flip the temporary chat to personalized. Idempotent: the pill only reads
   *  "Unpersonalized" while the choice is still open and still unmade. */
  async #setPersonalized() {
    const pill = this.page.getByText(PERSONALIZE_PILL, { exact: true }).first();
    if (!(await pill.isVisible().catch(() => false))) return;
    await pill.click();
    await sleep(1000);
    const item = this.page
      .getByRole("menuitemradio")
      .filter({ hasText: PERSONALIZE_ITEM })
      .first();
    if (await item.isVisible().catch(() => false)) await item.click();
    else await this.page.keyboard.press("Escape");
    await sleep(800);
    // Memory is the whole reason to consult. Losing it silently is worse than noisy.
    if (await pill.isVisible().catch(() => false)) {
      process.stderr.write("[pi-chatgpt] warning: chat stayed unpersonalized \u2014 no memory this turn\n");
    }
  }

  /** Change the thinking slider mid-thread. Chunk delivery wants Instant; the
   *  question wants High. */
  async setThinking(level) {
    return this.#setThinking(level);
  }

  async #setThinking(level) {
    const target = THINKING_LEVELS.indexOf(level);
    if (target < 0) return;

    const pill = this.page.locator(SEL.thinkingPill).first();
    if (!(await pill.isVisible().catch(() => false))) return;

    const current = await pill.innerText().catch(() => "");
    const currentIdx = THINKING_LEVELS.indexOf(current.trim());
    if (currentIdx === target) return;

    await pill.click();
    await sleep(500);

    const slider = this.page.locator(SEL.sliderControl);
    if (!(await slider.isVisible().catch(() => false))) {
      await this.page.keyboard.press("Escape");
      return;
    }
    await slider.focus();
    await sleep(200);

    // Reset to Instant (all the way left), then right to target
    for (let i = 0; i < 3; i++) await this.page.keyboard.press("ArrowLeft");
    await sleep(100);
    for (let i = 0; i < target; i++) {
      await this.page.keyboard.press("ArrowRight");
      await sleep(100);
    }

    await this.page.keyboard.press("Escape");
    await sleep(300);
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
    const deadline = Date.now() + this.timeoutMs;
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

const running = (app) => {
  try {
    execSync(`pgrep -f "${app}.app/Contents/MacOS/"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

async function waitCDP(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cdpAlive()) return true;
    await sleep(300);
  }
  return false;
}

/** Bring up CDP on a browser holding the real ChatGPT login.
 *
 *  macOS only applies `--args` at process start, so a browser already running
 *  without the flag has to be quit and relaunched. Arc restores its tabs. */
async function tryAttachRunning() {
  for (const app of ["Arc", "Google Chrome"]) {
    if (!existsSync(`/Applications/${app}.app`)) continue;
    try {
      if (running(app)) {
        process.stderr.write(
          `[pi-chatgpt] restarting ${app} with CDP on :${CDP_PORT} - open channels will be lost\n`,
        );
        try {
          execSync(`osascript -e 'quit app "${app}"'`, { timeout: 20_000, stdio: "ignore" });
        } catch {}
        for (let i = 0; i < 40 && running(app); i++) await sleep(500);
        // A modal or beforeunload handler can swallow the graceful quit.
        if (running(app)) {
          try {
            execSync(`pkill -f "${app}.app/Contents/MacOS/"`, { stdio: "ignore" });
          } catch {}
          for (let i = 0; i < 20 && running(app); i++) await sleep(500);
        }
        if (running(app)) continue;
      }
      execSync(`open -na "${app}" --args --remote-debugging-port=${CDP_PORT}`, {
        timeout: 10_000,
        stdio: "ignore",
      });
      if (await waitCDP(20_000)) {
        process.stderr.write(`[pi-chatgpt] CDP attached to ${app}\n`);
        return true;
      }
    } catch {}
  }
  return false;
}

let launched = false;

const LOCK = join(homedir(), ".pi-chatgpt", "cdp.lock");
const LOCK_STALE_MS = 120_000;

const lockAge = () => {
  try {
    return Date.now() - statSync(LOCK).mtimeMs;
  } catch {
    return Infinity;
  }
};

/** Serialize bring-up across concurrent agents: restarting the browser while
 *  another session is mid-answer would kill its tab. Losers wait for CDP. */
async function withBringupLock(fn) {
  mkdirSync(join(homedir(), ".pi-chatgpt"), { recursive: true });
  const deadline = Date.now() + LOCK_STALE_MS;
  while (Date.now() < deadline) {
    try {
      mkdirSync(LOCK);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (await cdpAlive()) return;
      if (lockAge() > LOCK_STALE_MS) rmSync(LOCK, { recursive: true, force: true });
      await sleep(500);
      continue;
    }
    try {
      return await fn();
    } finally {
      rmSync(LOCK, { recursive: true, force: true });
    }
  }
  throw new Error("Timed out waiting for another process to bring up the browser");
}

/** Ensure a CDP-enabled browser is running. Prefers an existing browser
 *  (inherits login sessions), falls back to launching Chrome off-screen. */
const ensureCDP = () => withBringupLock(bringUpCDP);

async function bringUpCDP() {
  if (await cdpAlive()) return;
  if (await tryAttachRunning()) return;
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
    // Real Chrome (not headless — Cloudflare blocks that) but invisible.
    "--window-position=-9999,-9999",
    "--window-size=1280,800",
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
