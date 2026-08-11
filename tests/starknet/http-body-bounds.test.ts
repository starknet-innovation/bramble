/**
 * MCW-V09-122: the wallet's external HTTP boundaries must cap the response body
 * they will read, so a hostile or compromised endpoint cannot exhaust the worker
 * by answering with an endless stream. These cases drive the price feed, the NFT
 * indexer, the Starkscan explorer, and the swap aggregator with over-budget
 * bodies and assert each one fails closed while a normal body still round-trips.
 *
 * The cap has to be spent as the bytes arrive. A boundary that buffers the whole
 * body and measures it afterwards passes a "refuses a huge body" test and still
 * loses the worker to the body it just bought, so every case here also asserts
 * how much the endpoint managed to emit before it was cut off.
 *
 * They also pin that each boundary actually reaches the shared bounded reader:
 * every request carries a deadline signal and the hardened options (no cookies,
 * no referrer, redirects refused). The reader's own deadline behaviour is
 * covered in tests/starknet/http-bounded-fetch.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { type BoundedHttpFetch, HTTP_BODY_LIMITS } from "../../src/shared/http-json";
import { createSwapService } from "../../src/starknet/avnu";
import { createHttpNftIndexer, type NftIndexerHttp } from "../../src/starknet/nft-indexer";
import { createPriceService, type HttpResponse } from "../../src/starknet/prices";
import {
  createStarkscanClient,
  StarkscanError,
  type StarkscanHttp,
} from "../../src/starknet/starkscan";
import { createMemoryStore } from "../../src/storage/kv";

const USDC = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const NFT_ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const STARKSCAN_BASE = "https://api.starkscan.test/v1";
const CHUNK_BYTES = 64 * 1024;

// The minimum shape the Starkscan address parser accepts, so a "normal body"
// case exercises the reader rather than the validator.
const addressSummary = (): Record<string, unknown> => ({
  activityCountExact: true,
  address: NFT_ADDRESS,
  classHash: null,
  createdOnIso: null,
  deployedAtTxHash: null,
  deployedByAddress: null,
  isAccount: null,
  latestActivityBlock: null,
  totalActivityCount: 0,
});

// A body that never stops arriving: valid JSON is promised but the endpoint
// keeps streaming padding, so only a reader that cancels on its own budget ever
// returns. `emitted` records how much it managed to push before being cut off.
const endlessBody = (): {
  readonly chunkBytes: number;
  readonly emitted: { bytes: number };
  readonly response: Response;
} => {
  const emitted = { bytes: 0 };
  const padding = new TextEncoder().encode(`{"pad":"${"a".repeat(CHUNK_BYTES)}`);
  return {
    chunkBytes: padding.byteLength,
    emitted,
    response: new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          emitted.bytes += padding.byteLength;
          controller.enqueue(padding);
        },
      }),
    ),
  };
};

const declaredHugeBody = (): Response =>
  new Response("{}", { headers: { "content-length": String(64 * 1024 * 1024) } });

describe("price feed response bounds", () => {
  const priceService = (response: () => Response) =>
    createPriceService({
      http: async () => response() as unknown as HttpResponse,
      now: () => 1000,
      store: createMemoryStore(),
    });

  test("refuses an endless price body and serves the empty cached snapshot", async () => {
    const { chunkBytes, emitted, response } = endlessBody();
    const prices = await priceService(() => response).getPrices({
      addresses: [USDC],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(prices.prices).toEqual({});
    expect(prices.stale).toBe(true);
    expect(emitted.bytes).toBeLessThanOrEqual(HTTP_BODY_LIMITS.price + 2 * chunkBytes);
  });

  test("refuses a body whose declared length is already over budget", async () => {
    const chart = await priceService(declaredHugeBody).getTokenChart({
      address: USDC,
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(chart.points).toEqual([]);
  });

  test("still reads a normal price body", async () => {
    const prices = await priceService(
      () => new Response(JSON.stringify({ [USDC]: { eur: 1.5, gbp: 1.2, usd: 2 } })),
    ).getPrices({ addresses: [USDC], currency: "usd", networkId: "SN_MAIN" });
    expect(prices.prices).toEqual({ [USDC]: 2 });
    expect(prices.stale).toBe(false);
  });
});

describe("NFT indexer response bounds", () => {
  const listOwned = (http: NftIndexerHttp) =>
    createHttpNftIndexer(http).listOwnedNfts({
      address: NFT_ADDRESS,
      indexerUrl: "https://indexer.example",
      networkId: "SN_MAIN",
    });

  test("refuses an endless indexer body and degrades to an empty gallery", async () => {
    const { chunkBytes, emitted, response } = endlessBody();
    expect(await listOwned(async () => response)).toEqual([]);
    expect(emitted.bytes).toBeLessThanOrEqual(HTTP_BODY_LIMITS.nftIndexer + 2 * chunkBytes);
  });

  test("refuses a body whose declared length is already over budget", async () => {
    expect(await listOwned(async () => declaredHugeBody())).toEqual([]);
  });

  test("still reads a normal indexer body", async () => {
    const nfts = await listOwned(
      async () =>
        new Response(
          JSON.stringify([{ contract_address: "0x0511a2b3", name: "Punk #1", token_id: "1" }]),
        ),
    );
    expect(nfts).toHaveLength(1);
  });
});

describe("Starkscan response bounds", () => {
  const getAddress = (http: StarkscanHttp) =>
    createStarkscanClient({ baseUrl: STARKSCAN_BASE, http }).getAddress("SN_MAIN", NFT_ADDRESS);

  test("cuts an endless explorer body off at its budget instead of buffering it", async () => {
    const { chunkBytes, emitted, response } = endlessBody();
    await expect(getAddress(async () => response)).rejects.toThrow(StarkscanError);
    expect(emitted.bytes).toBeLessThanOrEqual(HTTP_BODY_LIMITS.starkscan + 2 * chunkBytes);
  });

  test("refuses a body whose declared length is already over budget", async () => {
    await expect(getAddress(async () => declaredHugeBody())).rejects.toThrow(StarkscanError);
  });

  test("bounds the error body it reads back from a failed request", async () => {
    const { chunkBytes, emitted, response } = endlessBody();
    const failing = new Response(response.body, { status: 500 });
    await expect(getAddress(async () => failing)).rejects.toThrow(StarkscanError);
    expect(emitted.bytes).toBeLessThanOrEqual(HTTP_BODY_LIMITS.errorDetail + 2 * chunkBytes);
  });

  test("still reads a normal explorer body", async () => {
    const summary = await getAddress(async () => new Response(JSON.stringify(addressSummary())));
    expect(summary.address).toBe(NFT_ADDRESS);
  });
});

describe("swap aggregator response bounds", () => {
  const listTokens = (http: BoundedHttpFetch) => createSwapService({ http }).listTokens("SN_MAIN");

  test("cuts an endless aggregator body off at its budget", async () => {
    const { chunkBytes, emitted, response } = endlessBody();
    await expect(listTokens(async () => response)).rejects.toThrow("token list failed");
    expect(emitted.bytes).toBeLessThanOrEqual(HTTP_BODY_LIMITS.swap + 2 * chunkBytes);
  });

  test("refuses a body whose declared length is already over budget", async () => {
    await expect(listTokens(async () => declaredHugeBody())).rejects.toThrow("token list failed");
  });

  test("still reads a normal catalogue body", async () => {
    const tokens = await listTokens(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ address: USDC, decimals: 6, name: "USD Coin", symbol: "USDC" }],
          }),
        ),
    );
    expect(tokens).toHaveLength(1);
  });
});

describe("boundary request hardening", () => {
  // Records what the injected transport was actually asked to send. A boundary
  // that answered from cache, or that bypassed the shared reader, records
  // nothing — which is what makes this an honest check of the wiring.
  const recorder = (): { readonly http: BoundedHttpFetch; readonly inits: RequestInit[] } => {
    const inits: RequestInit[] = [];
    return {
      http: async (_url, init) => {
        inits.push(init);
        return new Response("{}");
      },
      inits,
    };
  };

  const expectHardened = (init: RequestInit | undefined): void => {
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  };

  test("the price feed sends a deadline and withholds cookies and referrer", async () => {
    const { http, inits } = recorder();
    await createPriceService({ http, now: () => 1000, store: createMemoryStore() }).getPrices({
      addresses: [USDC],
      currency: "usd",
      networkId: "SN_MAIN",
    });
    expect(inits).toHaveLength(1);
    expectHardened(inits[0]);
  });

  test("the NFT indexer sends a deadline and withholds cookies and referrer", async () => {
    const { http, inits } = recorder();
    await createHttpNftIndexer(http).listOwnedNfts({
      address: NFT_ADDRESS,
      indexerUrl: "https://indexer.example",
      networkId: "SN_MAIN",
    });
    expect(inits).toHaveLength(1);
    expectHardened(inits[0]);
  });

  test("Starkscan sends a deadline and withholds cookies and referrer", async () => {
    const inits: RequestInit[] = [];
    await createStarkscanClient({
      apiKey: "test-key",
      baseUrl: STARKSCAN_BASE,
      async http(_url, init) {
        inits.push(init);
        return new Response(JSON.stringify(addressSummary()));
      },
    }).getAddress("SN_MAIN", NFT_ADDRESS);
    expect(inits).toHaveLength(1);
    expectHardened(inits[0]);
    // The deadline the request carries is the one the body read is bounded by,
    // so a stalled stream cannot outlive the socket's own budget.
    expect(inits[0]?.headers).toMatchObject({ "X-Starkscan-Api-Key": "test-key" });
  });

  test("the swap aggregator sends a deadline and keeps its POST body", async () => {
    const { http, inits } = recorder();
    await createSwapService({ http })
      .listTokens("SN_MAIN")
      .catch(() => undefined);
    expect(inits).toHaveLength(1);
    expectHardened(inits[0]);

    const build = recorder();
    await createSwapService({ http: build.http })
      .buildCalls({
        networkId: "SN_MAIN",
        quoteId: "dae4e180-e2cb-49f4-bd91-6f3de3a0c3ca",
        slippage: 0.005,
        takerAddress: NFT_ADDRESS,
      })
      .catch(() => undefined);
    expect(build.inits).toHaveLength(1);
    expectHardened(build.inits[0]);
    expect(build.inits[0]?.method).toBe("POST");
    expect(String(build.inits[0]?.body ?? "")).toContain("includeApprove");
  });
});
