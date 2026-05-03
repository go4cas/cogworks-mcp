/**
 * @vaultbase/mcp — stdio↔HTTP bridge for the Vaultbase MCP server.
 *
 * Local MCP clients (Claude Desktop, Cursor, Zed, …) speak the protocol
 * over stdio. Vaultbase's Phase-3 HTTP transport at `/api/v1/mcp/` lets
 * remote agents connect over HTTPS. This package bridges the two:
 *
 *   client (stdio) ⇄ vaultbase-mcp ⇄ vaultbase (HTTP+SSE)
 *
 * No Bun runtime required on the client machine — pure Node, ships as a
 * single npm bin.
 */

export { runBridge, createBridge } from "./bridge.ts";
export type {
  BridgeOptions,
  BridgeHandle,
  Logger,
} from "./bridge.ts";
export { VERSION } from "./version.ts";
