# prototypes

## setup

Arc (or any Chromium) must be running with remote debugging:

```bash
# Quit Arc first, then:
open -a Arc --args --remote-debugging-port=9222

# Verify:
curl -s http://127.0.0.1:9222/json/version
```

Must be logged into ChatGPT Plus in that browser.

## working prototype

```bash
node proto/query.mjs "your prompt here"
echo "your prompt" | node proto/query.mjs
```

Connects via CDP, opens a temporary chat, sends prompt, polls DOM for response.
Verified: short answers (5s), code (5.5s), long essays (36s, 9500+ chars).

## other attempts

- `network-intercept.mjs` — captures SSE from backend-api/conversation but
  `response.text()` over CDP returns before the stream finishes. The delta
  encoding v1 parser works (append/patch ops on content parts), but the body
  is truncated. Would need raw CDP Fetch or WebSocket interception to fix.
- `dom-poll.mjs` — simplified version of query.mjs, same approach.
- clipboard extraction — copy button blocked by overlay div, discarded.

## findings

1. **Browser automation is required.** Cloudflare captcha blocks headless
   Playwright immediately. Must connect to a real browser session via CDP.
2. **DOM polling works reliably.** Both reference projects (codex-chatgpt-web,
   agentify-desktop) use this. Stability detection: stop button disappears +
   text unchanged for 3 polls.
3. **Network interception is cleaner in theory** but Playwright's CDP response
   body buffering doesn't handle SSE streams well. The SSE format uses delta
   encoding v1 (JSON patch-like ops), not raw message objects.
4. **Arc works as the browser host.** `open -a Arc --args --remote-debugging-port=9222`
   reuses the existing profile with ChatGPT session intact.
