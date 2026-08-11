/**
 * MCW-V09-122, the half that lives in the wiring rather than the reader.
 *
 * `fetchBoundedJson` composes a hardened request — an abort deadline, no
 * cookies, no referrer, and redirects refused — and hands it to the injected
 * transport. A transport that takes only `url` type-checks perfectly (TypeScript
 * accepts lower arity anywhere a two-parameter function is wanted) and discards
 * every one of those. The caller still gets its deadline, because the reader
 * races it wallet-side, so nothing looks broken: the request simply stays in
 * flight forever and follows a hostile 3xx wherever it points. Three of the
 * wallet's five boundaries shipped exactly that way.
 *
 * So these cases pin the wiring, not the module. Injected-transport assertions
 * elsewhere are structurally blind to this — they assert what the module PASSES,
 * never what production does with it — which is why the defect survived a round
 * of remediation with tests green.
 */
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createPhishingFeed } from "../../src/security/phishing-feed";
import {
  type BoundedHttpFetch,
  fetchBoundedJson,
  untrustedFetch,
} from "../../src/shared/http-json";
import { createHttpNftIndexer } from "../../src/starknet/nft-indexer";
import { createMemoryStore } from "../../src/storage/kv";

// The production defect, written the way it was actually written: a transport
// that accepts the composed request and throws it away. Kept as a control so
// each case below shows the difference the wiring makes rather than asserting
// into the void.
const initDroppingFetch: BoundedHttpFetch = (url, _init) => fetch(url);

type Hosted = {
  readonly hops: { count: number };
  readonly stop: () => void;
  readonly url: string;
};

// A host that answers every path with a redirect to /hop, and counts arrivals.
const redirectingHost = (payload: unknown): Hosted => {
  const hops = { count: 0 };
  const server = Bun.serve({
    fetch(request) {
      if (new URL(request.url).pathname === "/hop") {
        hops.count += 1;
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { headers: { location: "/hop" }, status: 302 });
    },
    port: 0,
  });
  return { hops, stop: () => server.stop(true), url: `http://localhost:${server.port}` };
};

describe("untrustedFetch is what reaches the socket", () => {
  test("hands the composed request straight through to the platform fetch", async () => {
    const seen: RequestInit[] = [];
    const platform = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response("{}");
    }) as typeof fetch;
    try {
      await fetchBoundedJson(untrustedFetch, "https://feed.example/x", 1024, 5_000);
    } finally {
      globalThis.fetch = platform;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.credentials).toBe("omit");
    expect(seen[0]?.redirect).toBe("error");
    expect(seen[0]?.referrerPolicy).toBe("no-referrer");
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("tears the socket down when the deadline expires", async () => {
    const disconnects = { count: 0 };
    const server = Bun.serve({
      fetch(request) {
        request.signal.addEventListener("abort", () => {
          disconnects.count += 1;
        });
        return new Promise<Response>(() => undefined);
      },
      port: 0,
    });
    const url = `http://localhost:${server.port}/never`;
    try {
      // The caller is rescued either way — the deadline is raced wallet-side —
      // so the caller's own rejection proves nothing about the connection. What
      // separates the two transports is whether the host ever sees the hang up.
      await expect(fetchBoundedJson(initDroppingFetch, url, 1024, 150)).rejects.toThrow(
        "timed out",
      );
      await Bun.sleep(200);
      expect(disconnects.count).toBe(0);

      await expect(fetchBoundedJson(untrustedFetch, url, 1024, 150)).rejects.toThrow("timed out");
      for (let waited = 0; waited < 40 && disconnects.count === 0; waited += 1) {
        await Bun.sleep(25);
      }
      expect(disconnects.count).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("refuses a redirect instead of following it, driving the real NFT indexer", async () => {
    const host = redirectingHost([{ contract_address: "0x1", token_id: "1" }]);
    try {
      const owned = { address: "0x1", indexerUrl: host.url, networkId: "SN_MAIN" } as const;
      expect(await createHttpNftIndexer(untrustedFetch).listOwnedNfts(owned)).toEqual([]);
      expect(host.hops.count).toBe(0);

      // The same indexer, wired the way production once was: the hop is
      // reached, and records from a host the wallet never chose come back.
      expect(await createHttpNftIndexer(initDroppingFetch).listOwnedNfts(owned)).toHaveLength(1);
      expect(host.hops.count).toBe(1);
    } finally {
      host.stop();
    }
  });

  test("refuses a redirect instead of following it, driving the real phishing feed", async () => {
    // The worst case is not a large body: it is a hop that answers with an
    // EMPTY blocklist, because that silently removes protection rather than
    // failing. The refusal keeps the previous snapshot instead.
    const host = redirectingHost({ blacklist: [] });
    const feed = (transport: BoundedHttpFetch) =>
      createPhishingFeed({
        fetch: transport,
        now: () => 10_000,
        source: `${host.url}/feed.json`,
        store: createMemoryStore(),
        ttlMs: 1,
      });
    try {
      expect([...(await feed(untrustedFetch).refresh())]).toEqual([]);
      expect(host.hops.count).toBe(0);

      await feed(initDroppingFetch).refresh();
      expect(host.hops.count).toBe(1);
    } finally {
      host.stop();
    }
  });
});

// Every `.ts` under src/, so a boundary wired tomorrow is scanned tomorrow.
const sourceFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
};

// A single-parameter arrow that immediately calls `fetch`: the exact shape of a
// transport that swallows the request the bounded reader composed. The
// parameter may carry a type annotation but never a comma, so a two-parameter
// transport that forwards its `init` does not match.
const INIT_DROPPING_ARROW =
  /\(\s*[A-Za-z_$][\w$]*\s*(?::\s*[^),\n]*)?\)\s*=>\s*(?:await\s+)?fetch\(/g;

// Comments are stripped first: several of these files quote the anti-pattern in
// prose precisely so the next author recognises it.
const codeOnly = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("no boundary is wired with a transport that drops the request", () => {
  test("src/ contains no single-argument fetch wrapper", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles("src")) {
      const text = codeOnly(await readFile(file, "utf8"));
      for (const match of text.matchAll(INIT_DROPPING_ARROW)) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    // Not a style rule. Each of these would type-check, pass every
    // injected-transport test, and silently unhardened one boundary.
    expect(offenders).toEqual([]);
  });

  test("every untrusted boundary names the shared transport", async () => {
    const wiring = [
      await readFile(join("src", "background", "index.ts"), "utf8"),
      await readFile(join("src", "background", "runtime-rpc.ts"), "utf8"),
    ].join("\n");
    // The price feed, the swap aggregator, the phishing list, the NFT indexer,
    // and Starkscan: the five boundaries the finding names, each constructed
    // with the one transport rather than a lambda written at the call site.
    for (const wired of [
      /createPriceService\(\{\s*http:\s*untrustedFetch/,
      /createSwapService\(\{\s*http:\s*untrustedFetch/,
      /createPhishingFeed\(\{\s*fetch:\s*untrustedFetch/,
      /nftIndexerHttp:\s*NftIndexerHttp\s*=\s*untrustedFetch/,
      /starkscanHttp:\s*StarkscanHttp\s*=\s*untrustedFetch/,
    ]) {
      expect(wiring).toMatch(wired);
    }
  });
});
