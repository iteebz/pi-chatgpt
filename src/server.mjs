/**
 * pi-chatgpt MCP server.
 *
 * Exposes local computer tools over stdio so ChatGPT web can drive
 * your machine via its native MCP connector support.
 *
 * Architecture:
 *   ChatGPT web ──MCP connector──▶ OpenAI tunnel ──▶ this server (stdio)
 *                                                      ├── shell
 *                                                      ├── file_read
 *                                                      └── file_write
 *
 * Prior art:
 *   - miuuyy/codex-chatgpt-web: full harness MCP server (turn-broker + browser)
 *   - agentify-sh/desktop: MCP tools wrapping browser automation
 *   - Codex itself: the tool contract this server reimplements
 *
 * This takes the opposite approach: no browser automation. ChatGPT is the
 * MCP client natively. We just give it tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { tools } from "./tools/index.mjs";
import { formatContext } from "./context.mjs";

const server = new McpServer({
  name: "pi-chatgpt",
  version: "0.1.0",
});

/** Convert our simple schema format to Zod for MCP SDK registration. */
function toZodSchema(schema) {
  const shape = {};
  for (const [key, def] of Object.entries(schema)) {
    let field;
    if (def.type === "number") field = z.number();
    else field = z.string();

    if (def.description) field = field.describe(def.description);
    if (def.optional) field = field.optional();

    shape[key] = field;
  }
  return shape;
}

// Register environment context as a resource
server.resource("environment", "context://environment", async (uri) => ({
  contents: [
    {
      uri: uri.href,
      mimeType: "text/plain",
      text: formatContext(),
    },
  ],
}));

// Register each tool with the MCP server
for (const [name, tool] of tools) {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: toZodSchema(tool.schema),
    },
    async (args) => {
      try {
        const result = tool.execute(args);
        return {
          content: [
            { type: "text", text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: err.message }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("pi-chatgpt MCP server running on stdio");
}

main().catch((err) => {
  console.error("pi-chatgpt fatal:", err);
  process.exit(1);
});
