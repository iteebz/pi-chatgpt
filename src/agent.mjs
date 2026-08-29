/**
 * The agent loop — local code owns control, ChatGPT owns judgment.
 *
 * Option B from docs/findings.md: browser session as transport, prose protocol
 * as the tool ABI, src/tools as the hands. No API key, no tunnel, no daemon.
 */

import { Session } from "./browser.mjs";
import { tools } from "./tools/index.mjs";
import { parse, renderResult, systemPrompt } from "./protocol.mjs";

export async function run(task, { cwd = process.cwd(), maxSteps = 20, log = () => {} } = {}) {
  const session = await new Session().open();
  const trace = [];

  try {
    let message = systemPrompt(task, cwd);

    for (let step = 1; step <= maxSteps; step++) {
      const t0 = Date.now();
      const reply = await session.ask(message);
      const ms = Date.now() - t0;
      const action = parse(reply);

      if (action.kind === "done") {
        log(`✓ ${action.summary}`);
        trace.push({ step, ms, done: action.summary });
        return { status: "done", summary: action.summary, steps: step, trace };
      }

      if (action.kind === "prose") {
        log(`… no tool call (step ${step}), reprompting`);
        trace.push({ step, ms, prose: reply.slice(0, 200) });
        message = "That reply had no fenced json block. Reply with exactly one fenced json tool call, or {\"done\": \"...\"}.";
        continue;
      }

      const tool = tools.get(action.name);
      log(`→ [${(ms / 1000).toFixed(1)}s] ${action.name} ${JSON.stringify(action.args).slice(0, 100)}`);

      let result;
      if (!tool) {
        result = { error: `Unknown tool "${action.name}". Available: ${[...tools.keys()].join(", ")}` };
      } else {
        try {
          result = await tool.execute({ cwd, ...action.args });
        } catch (err) {
          result = { error: err.message };
        }
      }

      trace.push({ step, ms, tool: action.name, args: action.args, result });
      message = renderResult(result);
    }

    return { status: "max_steps", steps: maxSteps, trace };
  } finally {
    await session.close();
  }
}
