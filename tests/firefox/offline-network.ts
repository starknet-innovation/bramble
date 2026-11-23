/**
 * The Firefox smoke's network: an HTTP proxy on loopback that is Firefox's only
 * route out, and that never dials anywhere but loopback itself.
 *
 * The Chromium suite blackholes DNS and answers the chain with `page.route`.
 * Classic WebDriver has no request interception, so here the same two jobs sit
 * behind one proxy:
 *
 * - A `CONNECT` to one of the wallet's mainnet RPC hosts (taken from
 *   `STARKNET_NETWORKS`, so it follows the bundled endpoints) is spliced to a
 *   local TLS server that answers as the Chromium suite's empty chain does
 *   (`emptyChainRpcResponse`). Its certificate is a throwaway self-signed one
 *   made per run; Firefox accepts it only because the session asks for
 *   `acceptInsecureCerts`, which no shipped profile has.
 * - Every other request, `CONNECT` or plain HTTP, is refused with a 403 and
 *   recorded, so the smoke can prove the blackhole rather than assume it.
 *
 * Test-only. Nothing here opens a connection off the machine.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { emptyChainRpcResponse } from "../e2e/test-wallet";

const MAX_HEAD_BYTES = 8_192;

/** What the proxy did with one request, in arrival order. */
type ProxyEvent = { readonly target: string; readonly verdict: "chain" | "refused" };

/** A running offline network; `close` stops both servers. */
export type OfflineNetwork = {
  readonly close: () => void;
  /** Every request the proxy saw. Read it after the step that should have caused one. */
  readonly events: readonly ProxyEvent[];
  readonly proxyPort: number;
};

// The onboarding scan reads mainnet: the wallet UI hard-wires first-run to it.
const CHAIN_TARGETS = new Set(
  STARKNET_NETWORKS.SN_MAIN.rpcUrls.map((url) => `${new URL(url).hostname}:443`),
);

const selfSignedCertificate = (dir: string): { cert: string; key: string } => {
  const made = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=bramble-firefox-smoke",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
    ],
    { encoding: "utf8" },
  );
  if (made.status !== 0) {
    throw new Error(`openssl could not make the smoke certificate: ${made.stderr || made.error}`);
  }
  return {
    cert: readFileSync(join(dir, "cert.pem"), "utf8"),
    key: readFileSync(join(dir, "key.pem"), "utf8"),
  };
};

const startChain = (dir: string): { port: number; stop: () => void } => {
  const server = Bun.serve({
    fetch: async (request) => {
      if (request.method !== "POST") return new Response(null, { status: 404 });
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json({
          error: { code: -32700, message: "Parse error" },
          id: null,
          jsonrpc: "2.0",
        });
      }
      return Response.json(emptyChainRpcResponse(body));
    },
    hostname: "127.0.0.1",
    port: 0,
    tls: selfSignedCertificate(dir),
  });
  if (server.port === undefined) throw new Error("the fake chain server has no port");
  return { port: server.port, stop: () => void server.stop(true) };
};

const splice = (client: Socket, chainPort: number, rest: Buffer): void => {
  const upstream = connect(chainPort, "127.0.0.1", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (rest.length > 0) upstream.write(rest);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
};

/**
 * Starts the fake chain and the proxy in front of it. `dir` holds the per-run
 * key and certificate; the caller deletes it.
 */
export const startOfflineNetwork = async (dir: string): Promise<OfflineNetwork> => {
  const chain = startChain(dir);
  const events: ProxyEvent[] = [];
  const proxy = createServer((client) => {
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end < 0) {
        if (head.length > MAX_HEAD_BYTES) client.destroy();
        return;
      }
      client.off("data", onData);
      const [method = "", target = ""] = head
        .subarray(0, head.indexOf("\r\n"))
        .toString("latin1")
        .split(" ");
      if (method === "CONNECT" && CHAIN_TARGETS.has(target)) {
        events.push({ target, verdict: "chain" });
        splice(client, chain.port, head.subarray(end + 4));
        return;
      }
      events.push({ target: `${method} ${target}`, verdict: "refused" });
      client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    };
    client.on("data", onData);
    client.on("error", () => client.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (typeof address !== "object" || address === null) throw new Error("the proxy has no port");
  return {
    close: () => {
      proxy.close();
      chain.stop();
    },
    events,
    proxyPort: address.port,
  };
};

/**
 * Firefox prefs that make the proxy its only route: manual proxy for every
 * scheme, no direct fallback, and no proxy bypass except loopback (which
 * nothing in the wallet reaches during the smoke). A proxied host is resolved
 * by the proxy, which resolves nothing; DNS prefetch and DNS-over-HTTPS are
 * off so Firefox does not look a name up on its own either.
 */
export const offlinePrefs = (proxyPort: number): Record<string, boolean | number | string> => ({
  "network.dns.disablePrefetch": true,
  "network.proxy.allow_hijacking_localhost": false,
  "network.proxy.failover_direct": false,
  "network.proxy.http": "127.0.0.1",
  "network.proxy.http_port": proxyPort,
  "network.proxy.no_proxies_on": "localhost,127.0.0.1",
  "network.proxy.share_proxy_settings": true,
  "network.proxy.ssl": "127.0.0.1",
  "network.proxy.ssl_port": proxyPort,
  "network.proxy.type": 1,
  "network.trr.mode": 5,
});
