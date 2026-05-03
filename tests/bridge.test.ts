/**
 * Bridge unit tests — drive `createBridge` with a stub fetch + EventSource.
 * No network, no stdio. Just verifies framing/auth headers.
 */

import { describe, expect, it } from "bun:test";
import { createBridge, type EventSourceLike } from "../src/bridge.ts";

interface StubCall {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (call: StubCall) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler({ url, init });
  }) as typeof fetch;
}

const QUIET_LOGGER = { info: () => {}, warn: () => {}, error: () => {} };

describe("createBridge", () => {
  it("forwards JSON-RPC POST with bearer auth", async () => {
    const calls: StubCall[] = [];
    const bridge = createBridge({
      url: "https://example.com/",
      token: "vbat_xyz",
      fetch: stubFetch((c) => {
        calls.push(c);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
      logger: QUIET_LOGGER,
    });

    const res = await bridge.forward({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(res).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://example.com/api/v1/mcp");
    expect(calls[0]!.init?.method).toBe("POST");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer vbat_xyz");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("returns null on 204 (notification)", async () => {
    const bridge = createBridge({
      url: "https://example.com",
      token: "vbat_x",
      fetch: stubFetch(() => new Response(null, { status: 204 })),
      logger: QUIET_LOGGER,
    });
    expect(await bridge.forward({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("throws on non-2xx", async () => {
    const bridge = createBridge({
      url: "https://example.com",
      token: "bad",
      fetch: stubFetch(() => new Response("Unauthorized", { status: 401 })),
      logger: QUIET_LOGGER,
    });
    await expect(bridge.forward({ jsonrpc: "2.0", id: 1, method: "ping" })).rejects.toThrow(/401/);
  });

  it("strips trailing slash from base URL", async () => {
    const calls: StubCall[] = [];
    const bridge = createBridge({
      url: "https://example.com///",
      token: "t",
      fetch: stubFetch((c) => {
        calls.push(c);
        return new Response("{}", { status: 200 });
      }),
      logger: QUIET_LOGGER,
    });
    await bridge.forward({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(calls[0]!.url).toBe("https://example.com/api/v1/mcp");
  });

  it("openEvents pipes parsed JSON to onMessage", async () => {
    let captured: { onmessage: ((ev: { data: string }) => void) | null } | null = null;
    const bridge = createBridge({
      url: "https://example.com",
      token: "t",
      fetch: stubFetch(() => new Response("{}", { status: 200 })),
      eventSourceFactory: (_url, _init) => {
        const es: EventSourceLike = {
          onmessage: null,
          onerror: null,
          close: () => {},
        };
        captured = es;
        return es;
      },
      logger: QUIET_LOGGER,
    });

    const seen: unknown[] = [];
    bridge.openEvents((m) => seen.push(m), () => {});
    expect(captured).not.toBeNull();
    captured!.onmessage?.({ data: '{"jsonrpc":"2.0","method":"notifications/tools/listChanged"}' });
    expect(seen).toEqual([{ jsonrpc: "2.0", method: "notifications/tools/listChanged" }]);
  });
});
