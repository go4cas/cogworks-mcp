/**
 * vaultbase-mcp — CLI entry point.
 *
 * Usage:
 *   vaultbase-mcp --url https://api.example.com --token vbat_…
 *
 * Defaults: VAULTBASE_URL / VAULTBASE_MCP_TOKEN / VAULTBASE_API_TOKEN env.
 *
 * Designed for Claude Desktop / Cursor / Continue MCP-server config:
 *
 *   "mcpServers": {
 *     "vaultbase": {
 *       "command": "npx",
 *       "args": ["-y", "@vaultbase/mcp"],
 *       "env": {
 *         "VAULTBASE_URL": "https://api.example.com",
 *         "VAULTBASE_MCP_TOKEN": "vbat_…"
 *       }
 *     }
 *   }
 */

import { runBridge } from "./bridge.ts";
import { VERSION } from "./version.ts";

interface Args {
  url?: string;
  token?: string;
  help?: boolean;
  version?: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--url":
      case "-u": {
        const v = argv[++i];
        if (v) out.url = v;
        break;
      }
      case "--token":
      case "-t": {
        const v = argv[++i];
        if (v) out.token = v;
        break;
      }
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--version":
      case "-v":
        out.version = true;
        break;
    }
  }
  return out;
}

const HELP = `vaultbase-mcp v${VERSION}
Bridge MCP-over-stdio (Claude Desktop / Cursor / …) to a remote Vaultbase
HTTP+SSE MCP endpoint.

Usage:
  vaultbase-mcp [--url <base>] [--token <vbat_...>]

Options:
  -u, --url <base>     Vaultbase base URL (or env VAULTBASE_URL)
  -t, --token <token>  API token with mcp:* scope
                       (or env VAULTBASE_MCP_TOKEN / VAULTBASE_API_TOKEN)
  -v, --version        Print version
  -h, --help           Show this help
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    process.stdout.write(`vaultbase-mcp ${VERSION}\n`);
    return;
  }

  const url = args.url ?? process.env.VAULTBASE_URL;
  const token =
    args.token ??
    process.env.VAULTBASE_MCP_TOKEN ??
    process.env.VAULTBASE_API_TOKEN;

  if (!url) {
    process.stderr.write("vaultbase-mcp: missing --url (or VAULTBASE_URL env).\n");
    process.exit(2);
  }
  if (!token) {
    process.stderr.write(
      "vaultbase-mcp: missing --token (or VAULTBASE_MCP_TOKEN / VAULTBASE_API_TOKEN env).\n",
    );
    process.exit(2);
  }

  const handle = runBridge({ url, token });
  await handle.done;
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`vaultbase-mcp: ${msg}\n`);
  process.exit(1);
});
