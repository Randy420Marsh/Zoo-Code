---
name: create-mcp-server
description: Use when the user asks for a new tool, capability or integration that no connected MCP server provides - for example "add a tool that gets the current price of Bitcoin", "I need a tool that talks to my company's user database", or "build an MCP server for the GitHub Gist API". Covers scaffolding the server project, implementing the tool, handling credentials and registering the server so its tools become available.
---

# Creating an MCP Server

An MCP server is a small standalone program that exposes tools and resources over the
Model Context Protocol. Build one when the user wants a capability that no currently
connected server offers.

Do not use this skill to _call_ an existing tool. If a connected server already exposes
something close to what was asked for, use that tool instead and say so.

## 1. Settle the contract before writing code

Confirm these with the user, asking only about what you genuinely cannot infer:

- **Tools** - the name, purpose and parameters of each tool the server will expose.
- **Data source** - the API, database or script behind it, and its base URL.
- **Credentials** - which API keys or tokens are needed, if any.
- **Location** - where the project should live. Default to a `mcp-servers/` directory
  next to the current workspace unless the user names somewhere else.

Ask for missing details with `ask_followup_question`. Never invent an API shape: if you
are unsure how an external service works, look at its documentation first.

## 2. Scaffold the project

Use TypeScript with the official SDK unless the user asks for another language.

```bash
mkdir -p <server-dir> && cd <server-dir>
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node
npx tsc --init
```

Set `"module": "Node16"`, `"moduleResolution": "Node16"`, `"target": "ES2022"` and
`"outDir": "./build"` in `tsconfig.json`, and add `"type": "module"` plus a
`"build": "tsc && node -e \"require('fs').chmodSync('build/index.js', '755')\""`
script to `package.json`.

## 3. Implement the server

A minimal STDIO server looks like this:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "<server-name>", version: "0.1.0" })

server.tool(
	"<tool_name>",
	"<what this tool does, and when to reach for it>",
	{ symbol: z.string().describe("Ticker symbol, e.g. BTC") },
	async ({ symbol }) => {
		const res = await fetch(`https://api.example.com/price/${symbol}`, {
			headers: { Authorization: `Bearer ${process.env.API_KEY}` },
		})

		if (!res.ok) {
			return {
				content: [{ type: "text", text: `Request failed: ${res.status} ${res.statusText}` }],
				isError: true,
			}
		}

		return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] }
	},
)

await server.connect(new StdioServerTransport())
```

Rules that matter for how well the finished server works:

- **Descriptions are the interface.** The tool description and every
  `.describe()` on a parameter are what a model reads to decide whether and how to call
  the tool. State what the tool does, what each parameter expects, its format, and what
  comes back. Vague descriptions are the most common reason a working server goes unused.
- **Never write to stdout** in a STDIO server - it is the protocol channel. Log to
  stderr with `console.error`.
- **Return errors as content** with `isError: true` rather than throwing, so the model
  can read what went wrong and retry.
- Validate every input with `zod`.

Then build it: `npm run build`.

## 4. Handle credentials

Never hardcode a secret, and never write one into a source file. Ask the user for the
value with `ask_followup_question`, then pass it through the server's `env` block in the
MCP settings file. For a secret the user already has in their environment, reference it
with `${env:VAR_NAME}` in `args` or `env` instead of copying the value.

## 5. Register the server

Add the server to the right settings file, preserving any entries already there:

- **Global** - `mcp_settings.json`, reachable from _Edit Global MCP_ in the MCP panel.
- **Project** - `.roo/mcp.json` in the workspace root, for a server the user's team
  should share. Use this when the server is specific to the project.

```json
{
	"mcpServers": {
		"<server-name>": {
			"command": "node",
			"args": ["<absolute-path>/build/index.js"],
			"env": { "API_KEY": "<value the user gave you>" },
			"disabled": false,
			"alwaysAllow": []
		}
	}
}
```

Use an absolute path to the built entry point. On Windows, a server launched through
`npx` needs `"command": "cmd"` with `"args": ["/c", "npx", "-y", "<package>"]`.

Leave `alwaysAllow` empty - auto-approval is the user's decision to make.

## 6. Verify

Saving the settings file makes Zoo Code pick the server up automatically. Confirm the
server appears connected in the MCP panel, then actually call one of its tools to prove
it works end to end. If it fails to connect, check the server's logs in the MCP panel:
a non-zero exit on startup is usually a bad path, a missing build, or a missing
environment variable.

Finish by telling the user the server name, the tools it exposes, and where the settings
were written.
