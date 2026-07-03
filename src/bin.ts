/**
 * cogworks-mcp — CLI entry point.
 *
 * Usage:
 *   cogworks-mcp --url https://api.example.com --token cwat_…
 *
 * Defaults: COGWORKS_URL / COGWORKS_MCP_TOKEN / COGWORKS_API_TOKEN env.
 *
 * Designed for Claude Desktop / Cursor / Continue MCP-server config:
 *
 *   "mcpServers": {
 *     "cogworks": {
 *       "command": "npx",
 *       "args": ["-y", "@cogworks/mcp"],
 *       "env": {
 *         "COGWORKS_URL": "https://api.example.com",
 *         "COGWORKS_MCP_TOKEN": "cwat_…"
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

const HELP = `cogworks-mcp v${VERSION}
Bridge MCP-over-stdio (Claude Desktop / Cursor / …) to a remote Cogworks
HTTP+SSE MCP endpoint.

Usage:
  cogworks-mcp [--url <base>] [--token <cwat_...>]

Options:
  -u, --url <base>     Cogworks base URL (or env COGWORKS_URL)
  -t, --token <token>  API token with mcp:* scope
                       (or env COGWORKS_MCP_TOKEN / COGWORKS_API_TOKEN)
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
    process.stdout.write(`cogworks-mcp ${VERSION}\n`);
    return;
  }

  // COGWORKS_* preferred; legacy VAULTBASE_* still honored for existing configs.
  const url = args.url ?? process.env.COGWORKS_URL ?? process.env.VAULTBASE_URL;
  const token =
    args.token ??
    process.env.COGWORKS_MCP_TOKEN ??
    process.env.COGWORKS_API_TOKEN ??
    process.env.VAULTBASE_MCP_TOKEN ??
    process.env.VAULTBASE_API_TOKEN;

  if (!url) {
    process.stderr.write("cogworks-mcp: missing --url (or COGWORKS_URL env).\n");
    process.exit(2);
  }
  if (!token) {
    process.stderr.write(
      "cogworks-mcp: missing --token (or COGWORKS_MCP_TOKEN / COGWORKS_API_TOKEN env).\n",
    );
    process.exit(2);
  }

  const handle = runBridge({ url, token });
  await handle.done;
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`cogworks-mcp: ${msg}\n`);
  process.exit(1);
});
