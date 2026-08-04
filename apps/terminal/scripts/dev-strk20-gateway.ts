/**
 * Local STRK20 gateway for wallet development.
 *
 * The production gateway keeps its discovery/prover upstream URLs in Vercel
 * env, so a fully local gateway cannot reach the privacy services directly.
 * This server instead chains to the deployed gateway: it accepts any request
 * from a locally loaded extension (no origin allowlist, permissive CORS) and
 * forwards it upstream with the privileged Fetch-Metadata shape the deployed
 * origin check requires. Bodies pass through untouched, so OHTTP envelopes
 * survive the hop. Development only — never deploy this listener.
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

const upstreamBase = process.env["STRK20_DEV_UPSTREAM"] ?? "https://mc-wallet-terminal.vercel.app";
const port = Number(process.env["PORT"] ?? 8787);

const corsHeaders = (request: Request): Record<string, string> => ({
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": request.headers.get("origin") ?? "*",
});

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors, status: 204 });
    }
    if (!url.pathname.startsWith("/api/strk20/")) {
      return new Response(JSON.stringify({ error: "route_not_allowed" }), {
        headers: { ...cors, "content-type": "application/json" },
        status: 404,
      });
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
    // shape; server-side fetches carry none, so restore it explicitly.
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
      return new Response(JSON.stringify({ error: "upstream_unavailable" }), {
        headers: { ...cors, "content-type": "application/json" },
        status: 502,
      });
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
  },
});

console.log(`STRK20 dev gateway on http://127.0.0.1:${server.port} -> ${upstreamBase}`);
