/**
 * Local STRK20 gateway for wallet development.
 *
 * The production gateway keeps its discovery/prover upstream URLs in Vercel
 * env, so a fully local gateway cannot reach the privacy services directly.
 * This server instead chains to the deployed gateway: it accepts requests only
 * from a locally loaded extension (an extension origin, or the privileged
 * extension Fetch-Metadata shape) and forwards them upstream with that shape,
 * which the deployed origin check requires. Every other caller, including web
 * pages on a localhost dev server, is refused, because the shape vouches for
 * the caller (Sherlock 244). Bodies pass through untouched, so OHTTP envelopes
 * survive the hop. Development only — never deploy this listener.
 *
 * The paymaster leg is different: the deployed gateway holds its own (currently
 * invalid) relay credential, so a local `AVNU_PAYMASTER_API_KEY` makes this
 * server forward paymaster calls straight to the relay upstream with that key
 * instead of chaining through production. The key is read from the environment
 * (Bun auto-loads `.env.local`, which is git-ignored), is never logged, and
 * never leaves this process except as a request header to the configured relay
 * origin: a paymaster path that could reach any other host is refused before
 * the key is attached (Sherlock 199).
 *
 * Usage:
 *   bun run dev:gateway            # listens on http://127.0.0.1:8787
 *   PORT=9000 bun run dev:gateway  # custom port
 *
 * Then point the wallet's STRK20 services (Settings → Network → Advanced
 * endpoints → STRK20 privacy services) at:
 *   discovery  http://127.0.0.1:8787/api/strk20/discovery
 *   prover     http://127.0.0.1:8787/api/strk20/prover
 *   paymaster  http://127.0.0.1:8787/api/strk20/paymaster
 */

import {
  bareHttpsOrigin,
  devGatewayCaller,
  devGatewayCorsHeaders,
  devGatewayPaymasterUrl,
  isDevGatewayPaymasterPath,
} from "../src/protocols/privacy/dev-gateway-policy";

// Both upstreams must be bare https origins, so a request path is only ever
// joined below a host fixed here. A misconfigured value stops the server.
const requireOrigin = (name: string, fallback: string): string => {
  const origin = bareHttpsOrigin(process.env[name] ?? fallback);
  if (origin === null) {
    throw new Error(`${name} must be a bare https:// origin`);
  }
  return origin;
};

const upstreamBase = requireOrigin("STRK20_DEV_UPSTREAM", "https://mc-wallet-terminal.vercel.app");
const port = Number(process.env["PORT"] ?? 8787);
const paymasterKey = process.env["AVNU_PAYMASTER_API_KEY"];
const paymasterUpstream = requireOrigin(
  "STRK20_PAYMASTER_UPSTREAM",
  "https://starknet.paymaster.avnu.fi",
);
const debugPaymaster = process.env["STRK20_DEBUG_PAYMASTER"] === "1";
const DEBUG_WINDOW_CHARS = 80;

// Relay rejections name a byte offset ("… at line 1 column 699") without saying
// which field sits there. With STRK20_DEBUG_PAYMASTER=1, print a narrow window
// of the request around that offset so the offending felt is identifiable. Only
// the window is printed, never the whole body, and never the credential.
const explainRejection = (body: string, response: string): void => {
  let column: number | null = null;
  const match = /column (\d+)/.exec(response);
  if (match?.[1] !== undefined) {
    column = Number(match[1]);
  }
  console.error(`  request was ${body.length} chars`);
  if (column === null || column > body.length) {
    console.error(`  relay said: ${response.slice(0, 300)}`);
    return;
  }
  const from = Math.max(0, column - DEBUG_WINDOW_CHARS);
  console.error(`  around column ${column}: …${body.slice(from, column + DEBUG_WINDOW_CHARS)}…`);
};

const jsonError = (cors: Record<string, string>, status: number, error: string): Response =>
  new Response(JSON.stringify({ error }), {
    headers: { ...cors, "content-type": "application/json" },
    status,
  });

// Forwards one paymaster JSON-RPC call directly to the relay with the local
// credential. Returns null when no key is configured so the caller falls back
// to chaining through the deployed gateway. The key is attached only after the
// target URL is known to be on the relay origin.
const forwardToPaymaster = async (
  request: Request,
  url: URL,
  cors: Record<string, string>,
): Promise<Response | null> => {
  if (paymasterKey === undefined || paymasterKey === "") {
    return null;
  }
  const target = devGatewayPaymasterUrl(paymasterUpstream, url.pathname, url.search);
  if (target === null) {
    return jsonError(cors, 404, "route_not_allowed");
  }
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("x-paymaster-api-key", paymasterKey);
  const accept = request.headers.get("accept");
  if (accept !== null) {
    headers.set("Accept", accept);
  }
  const body = request.method === "POST" ? await request.text() : undefined;
  try {
    const upstream = await fetch(target, {
      body,
      headers,
      method: request.method,
      redirect: "error",
    });
    if (!debugPaymaster || body === undefined) {
      return upstream;
    }
    // Reading the body consumes it, so hand back a fresh Response.
    const text = await upstream.text();
    if (text.includes('"error"')) {
      explainRejection(body, text);
    }
    return new Response(text, { headers: upstream.headers, status: upstream.status });
  } catch (error) {
    console.error(`${request.method} ${url.pathname} -> paymaster unreachable:`, error);
    return new Response(JSON.stringify({ error: "upstream_unavailable" }), {
      headers: { "content-type": "application/json" },
      status: 502,
    });
  }
};

/**
 * Answers one request to the dev gateway. Exported so the routing and caller
 * policy can be exercised without opening a socket; the listener below only
 * starts when this file is run directly.
 */
export const handleDevGatewayRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const caller = devGatewayCaller(request.headers);
  if (!caller.allowed) {
    return jsonError({}, 403, "origin_not_allowed");
  }
  const cors = devGatewayCorsHeaders(caller);
  if (!url.pathname.startsWith("/api/strk20/")) {
    return jsonError(cors, 404, "route_not_allowed");
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: cors, status: 204 });
  }
  if (isDevGatewayPaymasterPath(url.pathname)) {
    const direct = await forwardToPaymaster(request, url, cors);
    if (direct !== null) {
      console.log(`${request.method} ${url.pathname} -> paymaster ${direct.status} (local key)`);
      const responseHeaders = new Headers(cors);
      const type = direct.headers.get("content-type");
      if (type !== null) {
        responseHeaders.set("Content-Type", type);
      }
      return new Response(await direct.arrayBuffer(), {
        headers: responseHeaders,
        status: direct.status,
      });
    }
  }
  const headers = new Headers();
  const accept = request.headers.get("accept");
  const contentType = request.headers.get("content-type");
  if (accept !== null) {
    headers.set("Accept", accept);
  }
  if (contentType !== null) {
    headers.set("Content-Type", contentType);
  }
  // The deployed gateway admits extension traffic by its Fetch-Metadata
  // shape; server-side fetches carry none, so restore it explicitly. Only an
  // admitted extension caller reaches this point, so the shape vouches for
  // the caller it describes.
  headers.set("Sec-Fetch-Dest", "empty");
  headers.set("Sec-Fetch-Mode", "cors");
  headers.set("Sec-Fetch-Site", "none");
  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase}${url.pathname}${url.search}`, {
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
      headers,
      method: request.method,
      redirect: "error",
    });
  } catch (error) {
    console.error(`${request.method} ${url.pathname} -> upstream unreachable:`, error);
    return jsonError(cors, 502, "upstream_unavailable");
  }
  console.log(`${request.method} ${url.pathname} -> ${upstream.status}`);
  const responseHeaders = new Headers(cors);
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType !== null) {
    responseHeaders.set("Content-Type", upstreamType);
  }
  return new Response(await upstream.arrayBuffer(), {
    headers: responseHeaders,
    status: upstream.status,
  });
};

if (import.meta.main) {
  const server = Bun.serve({ fetch: handleDevGatewayRequest, hostname: "127.0.0.1", port });
  console.log(`STRK20 dev gateway on http://127.0.0.1:${server.port} -> ${upstreamBase}`);
}
