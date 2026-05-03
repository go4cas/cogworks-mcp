/**
 * Bidirectional bridge between MCP-over-stdio (what local clients expect)
 * and MCP-over-HTTP+SSE (what Vaultbase exposes remotely).
 *
 * Wire model:
 *
 *   ┌───────────────┐  stdin    ┌───────────────┐   POST /api/v1/mcp
 *   │ MCP client    │──────────▶│ vaultbase-mcp │──────────────────────▶
 *   │ (Claude, …)   │           │   (this pkg)  │
 *   │               │  stdout   │               │   GET  /api/v1/mcp/events
 *   │               │◀──────────│               │◀────────────────────── (SSE)
 *   └───────────────┘           └───────────────┘
 *
 * - Each newline-delimited JSON-RPC message read from stdin is forwarded
 *   as a POST. The HTTP response carries the matching response (or null
 *   for notifications), which we serialise back to stdout.
 * - The SSE stream carries server-initiated messages (notifications,
 *   `tools/listChanged`, future sampling requests). Each event payload
 *   is a complete JSON-RPC message; we write them straight to stdout.
 *
 * The bridge does not parse, modify, or route messages — it only frames
 * them for whichever transport is on the other side. All MCP semantics
 * stay in the Vaultbase server.
 */

export interface BridgeOptions {
  /** Vaultbase base URL — e.g. `https://api.example.com` (no trailing slash). */
  url: string;
  /** API token (`vbat_…`) with at least one `mcp:*` scope. */
  token: string;
  /** Optional fetch override (tests inject). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Optional EventSource override (tests inject). Defaults to lazy import. */
  eventSourceFactory?: (url: string, init: { headers: Record<string, string> }) => EventSourceLike;
  /** Optional logger; defaults to stderr. */
  logger?: Logger;
  /**
   * Per-request connect timeout (ms). Applied to the POST leg only —
   * the SSE leg streams indefinitely. Default 30s.
   */
  requestTimeoutMs?: number;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface BridgeHandle {
  /** Resolve when stdin closes and the bridge shuts down cleanly. */
  done: Promise<void>;
  /** Force shutdown (closes SSE + stops reading stdin). */
  close(): void;
}

/** Minimal EventSource shape we depend on — works with `eventsource` shim or DOM type. */
export interface EventSourceLike {
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

const stderrLogger: Logger = {
  info: (s) => process.stderr.write(`[vaultbase-mcp] ${s}\n`),
  warn: (s) => process.stderr.write(`[vaultbase-mcp] WARN ${s}\n`),
  error: (s) => process.stderr.write(`[vaultbase-mcp] ERROR ${s}\n`),
};

/**
 * Build a bridge but defer wiring stdin/stdout. Useful for tests; the
 * CLI uses `runBridge` instead.
 */
export function createBridge(opts: BridgeOptions): {
  /** Forward one client→server JSON-RPC message. Returns the response (or null). */
  forward(msg: unknown): Promise<unknown | null>;
  /** Open the SSE leg; `onMessage` fires for each server→client message. */
  openEvents(onMessage: (msg: unknown) => void, onError: (err: Error) => void): { close(): void };
  /** Verify the server is reachable + the token is accepted. */
  ping(): Promise<void>;
} {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const log = opts.logger ?? stderrLogger;
  const timeoutMs = opts.requestTimeoutMs ?? 30_000;
  const base = opts.url.replace(/\/+$/, "");
  const rpcUrl = `${base}/api/v1/mcp`;
  const sseUrl = `${base}/api/v1/mcp/events`;

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  });

  return {
    async forward(msg) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchFn(rpcUrl, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(msg),
          signal: ctrl.signal,
        });
        if (res.status === 204) return null;
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
        }
        const text = await res.text();
        if (!text.trim()) return null;
        return JSON.parse(text);
      } finally {
        clearTimeout(t);
      }
    },

    openEvents(onMessage, onError) {
      const factory = opts.eventSourceFactory ?? defaultEventSourceFactory(log);
      const es = factory(sseUrl, { headers: { Authorization: `Bearer ${opts.token}` } });
      es.onmessage = (ev) => {
        try {
          onMessage(JSON.parse(ev.data));
        } catch (e) {
          onError(e instanceof Error ? e : new Error(String(e)));
        }
      };
      es.onerror = (e) => {
        onError(e instanceof Error ? e : new Error("SSE connection error"));
      };
      return { close: () => es.close() };
    },

    async ping() {
      const r = await this.forward({ jsonrpc: "2.0", id: 0, method: "ping", params: {} });
      if (!r) throw new Error("Server returned empty response to ping");
    },
  };
}

/**
 * CLI entry: read stdin, forward to HTTP, write responses + SSE events
 * to stdout. Resolves when stdin closes.
 */
export function runBridge(opts: BridgeOptions): BridgeHandle {
  const log = opts.logger ?? stderrLogger;
  const bridge = createBridge(opts);

  let closed = false;
  const events = bridge.openEvents(
    (msg) => writeLine(msg),
    (err) => log.warn(`SSE: ${err.message}`),
  );

  const done = (async () => {
    log.info(`bridging stdio ⇄ ${opts.url}`);
    try {
      await bridge.ping();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`ping failed: ${msg}`);
      throw e;
    }
    for await (const line of readLines(process.stdin)) {
      if (closed) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let req: unknown;
      try {
        req = JSON.parse(trimmed);
      } catch {
        writeLine({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
        continue;
      }
      try {
        const res = await bridge.forward(req);
        if (res !== null && res !== undefined) writeLine(res);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`forward failed: ${msg}`);
        const id = (req as { id?: unknown })?.id ?? null;
        writeLine({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: `Bridge error: ${msg}` },
        });
      }
    }
  })().finally(() => {
    closed = true;
    events.close();
  });

  return {
    done,
    close: () => {
      closed = true;
      events.close();
    },
  };
}

function writeLine(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function* readLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let pending = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      yield pending.slice(0, nl);
      pending = pending.slice(nl + 1);
    }
  }
  if (pending) yield pending;
}

/**
 * Default EventSource factory — uses Node 18+ undici fetch streaming,
 * since Node's built-in `EventSource` only landed in v22. For broad
 * compatibility we implement a minimal SSE parser here rather than
 * adding an `eventsource` runtime dep.
 */
function defaultEventSourceFactory(log: Logger): NonNullable<BridgeOptions["eventSourceFactory"]> {
  return (url, init) => {
    let onmessage: ((ev: { data: string }) => void) | null = null;
    let onerror: ((ev: unknown) => void) | null = null;
    const ctrl = new AbortController();
    let closed = false;

    const start = async (): Promise<void> => {
      try {
        const res = await fetch(url, {
          headers: { ...init.headers, Accept: "text/event-stream" },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          onerror?.(new Error(`SSE HTTP ${res.status}`));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const data = event
              .split(/\r?\n/)
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (data && onmessage) onmessage({ data });
          }
        }
      } catch (e) {
        if (!closed) {
          log.warn(`SSE stream ended: ${e instanceof Error ? e.message : String(e)}`);
          onerror?.(e);
        }
      }
    };

    void start();

    const handle: EventSourceLike = {
      get onmessage() { return onmessage; },
      set onmessage(v) { onmessage = v; },
      get onerror() { return onerror; },
      set onerror(v) { onerror = v; },
      close() {
        closed = true;
        ctrl.abort();
      },
    };
    return handle;
  };
}
