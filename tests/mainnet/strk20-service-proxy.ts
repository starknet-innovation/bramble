/**
 * Loopback-only discovery/prover proxy for the local mainnet suite. Upstream
 * URLs remain process-local environment inputs and never enter the extension
 * bundle, its storage, or Playwright artifacts.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { sanitizeStrk20Detail } from "../../src/starknet/strk20/official-sdk-errors";

const HOST = "127.0.0.1";
const PORT = 5_050;
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

type ProxyService = "discovery" | "prover" | "rpc";

const ALLOWED_PATHS: Readonly<Record<ProxyService, ReadonlySet<string>>> = {
  discovery: new Set([
    "",
    "health",
    "ohttp-keys",
    "v1/history",
    "v1/sync/incoming_state",
    "v1/sync/outgoing_state",
    "v1/sync/preflight_check",
  ]),
  prover: new Set(["", "ohttp-keys"]),
  rpc: new Set([""]),
};

type ProxyRoute = {
  readonly path: string;
  readonly service: ProxyService;
};

/**
 * Parses only the fixed STRK20 test-proxy routes and methods. Request data is
 * reduced to an allowlisted route key before any upstream URL is selected.
 */
export const readStrk20ProxyRoute = (
  pathname: string,
  method: string | undefined,
): ProxyRoute | null => {
  const match =
    /^\/strk20-e2e\/(discovery|prover|rpc)(?:\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*))?\/?$/.exec(
      pathname,
    );
  if (!match) {
    return null;
  }
  const service = match[1] as ProxyService;
  const path = match[2] ?? "";
  if (!ALLOWED_PATHS[service].has(path)) {
    return null;
  }
  if (service === "rpc") {
    return method === "POST" && path === "" ? { path, service } : null;
  }
  if (path === "ohttp-keys" || path === "health") {
    return method === "GET" ? { path, service } : null;
  }
  return method === "POST" ? { path, service } : null;
};

const readRequestRoute = (request: IncomingMessage): ProxyRoute | null => {
  const rawTarget = request.url ?? "/";
  if (rawTarget.includes("..") || /%2e/i.test(rawTarget)) {
    return null;
  }
  const requestUrl = new URL(rawTarget, `http://${HOST}:${PORT}`);
  return requestUrl.search === ""
    ? readStrk20ProxyRoute(requestUrl.pathname, request.method)
    : null;
};

const routeTargets = (base: URL, paths: ReadonlySet<string>): ReadonlyMap<string, URL> =>
  new Map(
    [...paths].map((path) => {
      const target = new URL(base);
      if (path !== "") {
        target.pathname = `${target.pathname.replace(/\/+$/, "")}/${path}`;
      }
      return [path, target] as const;
    }),
  );

export type Strk20ServiceProxy = {
  readonly activity: () => readonly string[];
  readonly close: () => Promise<void>;
  readonly discoveryUrl: string;
  readonly proverUrl: string;
  readonly rpcUrl: string;
};

const readBody = (request: IncomingMessage): Promise<ArrayBuffer | undefined> =>
  new Promise((resolveBody, rejectBody) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    request.on("data", (chunk: Uint8Array) => {
      total += chunk.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        rejectBody(new Error("STRK20 test-proxy request exceeded its size limit"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolveBody(undefined);
        return;
      }
      const body = Buffer.concat(chunks, total);
      resolveBody(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    });
    request.on("error", rejectBody);
  });

const closeServer = (
  server: ReturnType<typeof createServer>,
  sockets: ReadonlySet<Socket>,
): Promise<void> =>
  new Promise((resolveClose, rejectClose) => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
} as const;

const rpcMethod = (body: ArrayBuffer | undefined): string => {
  if (!body) {
    return "unknown";
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(body)) as { readonly method?: unknown };
    return typeof value.method === "string" && /^starknet_[A-Za-z]+$/.test(value.method)
      ? value.method
      : "unknown";
  } catch {
    return "unknown";
  }
};

const rpcFailure = (body: Uint8Array): string | null => {
  try {
    const value = JSON.parse(new TextDecoder().decode(body)) as {
      readonly error?: { readonly code?: unknown; readonly message?: unknown };
    };
    if (!value.error) {
      return null;
    }
    const code = typeof value.error.code === "number" ? String(value.error.code) : "unknown";
    const message =
      typeof value.error.message === "string"
        ? sanitizeStrk20Detail(value.error.message)
        : "unknown";
    return `error=${code} ${message}`;
  } catch {
    return "error=malformed-response";
  }
};

/**
 * Starts a fixed-port proxy covered by the extension's loopback host grant.
 * Only the discovery, prover, and RPC prefixes are accepted; response/request bodies
 * are forwarded without being logged or retained.
 */
export const startStrk20ServiceProxy = async (input: {
  readonly discoveryUpstream: string;
  readonly proverUpstream: string;
  readonly rpcUpstream: string;
}): Promise<Strk20ServiceProxy> => {
  const activity: string[] = [];
  const sockets = new Set<Socket>();
  const upstreamTargets = {
    discovery: routeTargets(new URL(input.discoveryUpstream), ALLOWED_PATHS.discovery),
    prover: routeTargets(new URL(input.proverUpstream), ALLOWED_PATHS.prover),
    rpc: routeTargets(new URL(input.rpcUpstream), ALLOWED_PATHS.rpc),
  } as const;
  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }
    const route = readRequestRoute(request);
    const target = route ? upstreamTargets[route.service].get(route.path) : undefined;
    if (!route || !target) {
      response.writeHead(404, { ...corsHeaders, "content-type": "application/json" });
      response.end('{"error":"not_found"}');
      return;
    }
    const { service } = route;
    try {
      const body = await readBody(request);
      const upstream = await fetch(target, {
        ...(body === undefined ? {} : { body }),
        headers: {
          ...(request.headers.accept ? { accept: request.headers.accept } : {}),
          ...(request.headers["content-type"]
            ? { "content-type": request.headers["content-type"] }
            : {}),
        },
        method: request.method ?? "GET",
      });
      if (service !== "rpc") {
        activity.push(`${service} ${request.method ?? "GET"} ${upstream.status}`);
      }
      const responseBody = new Uint8Array(await upstream.arrayBuffer());
      if (service === "rpc") {
        const failure = rpcFailure(responseBody);
        if (failure || !upstream.ok) {
          activity.push(
            `rpc ${rpcMethod(body)} HTTP ${upstream.status} ${failure ?? "error=http"}`,
          );
        }
      }
      response.writeHead(upstream.status, {
        ...corsHeaders,
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      });
      response.end(responseBody);
    } catch {
      if (service !== "rpc") {
        activity.push(`${service} ${request.method ?? "GET"} transport-error`);
      }
      if (!response.headersSent) {
        response.writeHead(502, { ...corsHeaders, "content-type": "application/json" });
      }
      response.end('{"error":"upstream_failed"}');
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(PORT, HOST, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const base = `http://${HOST}:${PORT}/strk20-e2e`;
  return {
    activity: () => [...activity],
    close: () => closeServer(server, sockets),
    discoveryUrl: `${base}/discovery/`,
    proverUrl: `${base}/prover/`,
    rpcUrl: `${base}/rpc/`,
  };
};
