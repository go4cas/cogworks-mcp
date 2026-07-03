# @cogworks/mcp

Stdio↔HTTP bridge for the [Cogworks](https://cogworks.dev) MCP server.

Cogworks ships a first-party [Model Context Protocol](https://modelcontextprotocol.io)
server. When you run cogworks locally you can wire it up over stdio with
`cogworks mcp`. When the deployment lives on a remote host (or you don't
want to install the binary on every developer machine), this package
bridges the local MCP client (Claude Desktop, Cursor, Continue, Cline,
Zed, …) to Cogworks's HTTP+SSE transport at `/api/v1/mcp/`.

```
client (stdio) ⇄ @cogworks/mcp ⇄ cogworks (HTTPS + SSE)
```

Pure TypeScript, ships as a single npm bin, requires Node ≥ 18. No Bun
runtime needed on the client.

## Install

```sh
npm install -g @cogworks/mcp
# or use directly via npx
npx @cogworks/mcp --url https://api.example.com --token cwat_…
```

## Claude Desktop config

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "cogworks": {
      "command": "npx",
      "args": ["-y", "@cogworks/mcp"],
      "env": {
        "COGWORKS_URL": "https://api.example.com",
        "COGWORKS_MCP_TOKEN": "cwat_eyJhbGciOiJIUzI1NiIs…"
      }
    }
  }
}
```

Mint a token via the admin UI (`/_/api-tokens`) or the CLI on the host:

```sh
cogworks token mint --name "Claude Desktop" --scope mcp:read --ttl 1y
```

## Cursor / Continue / Cline / Zed

Same pattern — each editor has an MCP-server config block. Use
`command: "npx"`, `args: ["-y", "@cogworks/mcp"]`, supply
`COGWORKS_URL` + `COGWORKS_MCP_TOKEN` env vars.

## Programmatic usage

```ts
import { runBridge } from "@cogworks/mcp";

const handle = runBridge({
  url: "https://api.example.com",
  token: process.env.COGWORKS_MCP_TOKEN!,
});
await handle.done;
```

The bridge does not parse or rewrite MCP messages — it only frames them
for whichever transport is on the other side. All MCP semantics
(tools, resources, prompts, scope enforcement, audit logging) stay in
the Cogworks server.

## Compatibility

| `@cogworks/mcp` | Cogworks server |
|---|---|
| `0.1.x` | `>= 0.10.0` |

The Phase-3 HTTP+SSE transport ships in Cogworks **0.10**. Earlier
servers only speak stdio — point Claude Desktop directly at the
`cogworks` binary instead.

## License

MIT — © 2026 Cogworks contributors
