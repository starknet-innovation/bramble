/**
 * Starkscan NFT positions over the wallet's existing Starkscan client: the
 * request, the strict page parser, and the discovery adapter's Mainnet,
 * explorer-lane, owner and coverage rules. Fixtures are schema-derived, not a
 * live capture (see the support module).
 */
import { describe, expect, test } from "bun:test";
import { createStarkscanClient, StarkscanError } from "@bramble/transactions/starkscan";
import { createStarkscanNftSource } from "@bramble/transactions/starkscan-nfts";
import type { ExplorerLanePreferences } from "@bramble/wallet-model/preferences";
import {
  STARKSCAN_COLLECTION,
  STARKSCAN_OWNER,
  starkscanCoverage,
  starkscanPage,
  starkscanPosition,
} from "../support/starkscan-nft-fixture";

const BASE = "https://starkscan.test/v1";

const clientAnswering = (body: unknown, status = 200) => {
  const requests: Array<{ readonly init: RequestInit; readonly url: string }> = [];
  const client = createStarkscanClient({
    baseUrl: BASE,
    async http(url, init) {
      requests.push({ init, url });
      return new Response(JSON.stringify(body), { status });
    },
  });
  return { client, requests };
};

const discover = async (
  body: unknown,
  options: {
    readonly networkId?: "SN_MAIN" | "SN_SEPOLIA";
    readonly preferences?: ExplorerLanePreferences;
    readonly status?: number;
  } = {},
) => {
  const { client, requests } = clientAnswering(body, options.status);
  const source = createStarkscanNftSource({
    client,
    readPreferences: async () => options.preferences ?? {},
  });
  const result = await source({
    address: STARKSCAN_OWNER,
    networkId: options.networkId ?? "SN_MAIN",
  });
  return { requests, result };
};

describe("Starkscan client: NFT positions", () => {
  test("requests one page on the existing base with only the address and limit", async () => {
    const { client, requests } = clientAnswering(starkscanPage());
    const page = await client.getAddressNftPositions("SN_MAIN", STARKSCAN_OWNER);
    expect(requests.map((request) => request.url)).toEqual([
      `${BASE}/SN_MAIN/address/0x${BigInt(STARKSCAN_OWNER).toString(16)}/nft-positions?limit=100`,
    ]);
    expect(requests[0]?.init.headers).toEqual({ accept: "application/json" });
    expect(requests[0]?.init.redirect).toBe("error");
    expect(page.items.map((item) => item.tokenId)).toEqual(["1", "2"]);
    expect(page.items[0]?.collectionName).toBe("Punks");
  });

  test("refuses an out-of-range limit before any request", () => {
    const { client } = clientAnswering(starkscanPage());
    expect(() => client.getAddressNftPositions("SN_MAIN", STARKSCAN_OWNER, 101)).toThrow(
      StarkscanError,
    );
  });

  describe("refuses a malformed page", () => {
    const many = Array.from({ length: 101 }, (_unused, index) => starkscanPosition(String(index)));
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ["a non-object body", []],
      ["another schema version", starkscanPage(undefined, { schemaVersion: "v2" })],
      ["a malformed owner", starkscanPage(undefined, { ownerAddress: "me" })],
      ["a missing hasMore", starkscanPage(undefined, { hasMore: undefined })],
      ["a numeric cursor", starkscanPage(undefined, { nextCursor: 5 })],
      ["a negative snapshot block", starkscanPage(undefined, { snapshotBlock: -1 })],
      ["more items than a page", starkscanPage(many)],
      ["items that are not an array", starkscanPage(undefined, { items: {} })],
      ["a missing coverage", starkscanPage(undefined, { coverage: null })],
      [
        "an unknown coverage status",
        starkscanPage([], { coverage: starkscanCoverage({ status: "done" }) }),
      ],
      [
        "non-string reason codes",
        starkscanPage([], { coverage: starkscanCoverage({ reasonCodes: [1] }) }),
      ],
      [
        "a fractional indexed block",
        starkscanPage([], { coverage: starkscanCoverage({ indexedThroughBlock: 1.5 }) }),
      ],
      ["an ERC-1155 item", starkscanPage([starkscanPosition("1", { standard: "erc1155" })])],
      ["other evidence", starkscanPage([starkscanPosition("1", { evidenceSource: "guess" })])],
      ["a non-felt contract", starkscanPage([starkscanPosition("1", { tokenAddress: "0xzz" })])],
      ["a negative token id", starkscanPage([starkscanPosition("-1")])],
      ["a numeric token id", starkscanPage([starkscanPosition("1", { tokenId: 1 })])],
      [
        "a malformed transfer hash",
        starkscanPage([starkscanPosition("1", { lastTransferHash: "x" })]),
      ],
      [
        "a missing observed block",
        starkscanPage([starkscanPosition("1", { observedAtBlock: null })]),
      ],
      ["a missing collection", starkscanPage([starkscanPosition("1", { collection: null })])],
      [
        "an unknown metadata status",
        starkscanPage([
          starkscanPosition("1", { collection: { metadataStatus: "x", name: null, symbol: null } }),
        ]),
      ],
      [
        "a numeric collection name",
        starkscanPage([
          starkscanPosition("1", {
            collection: { metadataStatus: "indexed", name: 5, symbol: null },
          }),
        ]),
      ],
    ];
    for (const [name, body] of cases) {
      test(name, async () => {
        const { client } = clientAnswering(body);
        await expect(client.getAddressNftPositions("SN_MAIN", STARKSCAN_OWNER)).rejects.toThrow(
          StarkscanError,
        );
      });
    }
  });
});

describe("Starkscan NFT discovery source", () => {
  test("a complete page yields canonical candidates", async () => {
    const { result } = await discover(
      starkscanPage([starkscanPosition("0xff", { tokenAddress: "0x0511A2B3" })]),
    );
    expect(result).toEqual({
      coverage: "complete",
      nfts: [
        {
          collection: "Punks",
          contract: STARKSCAN_COLLECTION,
          id: `SN_MAIN:${STARKSCAN_COLLECTION}:255`,
          image: "",
          name: "",
          networkId: "SN_MAIN",
          tokenId: "255",
        },
      ],
    });
  });

  test("an empty complete page is a real empty answer", async () => {
    expect((await discover(starkscanPage([]))).result).toEqual({ coverage: "complete", nfts: [] });
  });

  describe("coverage that is not complete is incomplete, never empty", () => {
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["status partial", { coverage: starkscanCoverage({ status: "partial" }) }],
      [
        "not complete within scope",
        { coverage: starkscanCoverage({ completeWithinScope: false }) },
      ],
      ["an unknown scope", { coverage: starkscanCoverage({ declaredScope: "erc721_and_more" }) }],
      ["more pages", { hasMore: true, nextCursor: "c1" }],
      [
        "history before the indexed floor",
        {
          coverage: starkscanCoverage({
            reasonCodes: ["unsupported_erc1155", "indexed_history_floor"],
          }),
        },
      ],
      ["an unknown reason", { coverage: starkscanCoverage({ reasonCodes: ["new_gap"] }) }],
    ];
    for (const [name, overrides] of cases) {
      test(name, async () => {
        const { result } = await discover(starkscanPage([], overrides));
        expect(result).toEqual({ coverage: "incomplete", nfts: [] });
      });
    }
  });

  describe("unavailable, never empty", () => {
    const cases: ReadonlyArray<readonly [string, unknown, number?]> = [
      ["another chain", starkscanPage(undefined, { chainId: "SN_SEPOLIA" })],
      ["another owner", starkscanPage(undefined, { ownerAddress: "0x999" })],
      ["a zero contract", starkscanPage([starkscanPosition("1", { tokenAddress: "0x0" })])],
      ["a token id past u256", starkscanPage([starkscanPosition((1n << 256n).toString())])],
      ["a duplicate position", starkscanPage([starkscanPosition("1"), starkscanPosition("0x1")])],
      ["a malformed page", { items: [] }],
      ["a 403", { code: "forbidden" }, 403],
      ["a 429", { code: "rate_limited" }, 429],
      ["a 503", { code: "unavailable" }, 503],
    ];
    for (const [name, body, status] of cases) {
      test(name, async () => {
        const { result } = await discover(body, status === undefined ? {} : { status });
        expect(result).toEqual({ coverage: "unavailable", nfts: [] });
      });
    }
    test("a transport failure", async () => {
      const client = createStarkscanClient({
        baseUrl: BASE,
        async http() {
          throw new TypeError("offline");
        },
      });
      const source = createStarkscanNftSource({ client, readPreferences: async () => ({}) });
      expect(await source({ address: STARKSCAN_OWNER, networkId: "SN_MAIN" })).toEqual({
        coverage: "unavailable",
        nfts: [],
      });
    });
  });

  test("a hostile collection name is dropped, not allowed to refuse the page", async () => {
    const named = (name: unknown, metadataStatus = "indexed") =>
      starkscanPosition("1", { collection: { metadataStatus, name, symbol: null } });
    const rlo = String.fromCodePoint(0x202e);
    const alm = String.fromCodePoint(0x061c);
    const bell = String.fromCodePoint(0x07);
    for (const name of [`Punks${rlo}evil`, `a${bell}b`, `Punks${alm}`, "x".repeat(65), null]) {
      const { result } = await discover(starkscanPage([named(name)]));
      expect(result.nfts[0]?.collection).toBe("");
    }
    const { result } = await discover(starkscanPage([named("Stale", "unavailable")]));
    expect(result.nfts[0]?.collection).toBe("");
  });

  test("Sepolia sends nothing and reports no discovery", async () => {
    const { requests, result } = await discover(starkscanPage(), { networkId: "SN_SEPOLIA" });
    expect(result).toEqual({ coverage: "none", nfts: [] });
    expect(requests).toEqual([]);
  });

  test("the user's explorer choice is honoured: kept off Mainnet, nothing is sent", async () => {
    const off = { explorerFallback: { SN_MAIN: false } } as ExplorerLanePreferences;
    const { requests, result } = await discover(starkscanPage(), { preferences: off });
    expect(result).toEqual({ coverage: "none", nfts: [] });
    expect(requests).toEqual([]);
  });

  test("an unreadable preferences store sends nothing", async () => {
    const { client, requests } = clientAnswering(starkscanPage());
    const source = createStarkscanNftSource({
      client,
      async readPreferences() {
        throw new Error("store offline");
      },
    });
    expect(await source({ address: STARKSCAN_OWNER, networkId: "SN_MAIN" })).toEqual({
      coverage: "none",
      nfts: [],
    });
    expect(requests).toEqual([]);
  });

  test("a per-network explorer base override is used", async () => {
    const fallback = clientAnswering(starkscanPage());
    const configured = clientAnswering(starkscanPage());
    const source = createStarkscanNftSource({
      client: fallback.client,
      clientFor: () => configured.client,
      readPreferences: async () => ({}),
    });
    await source({ address: STARKSCAN_OWNER, networkId: "SN_MAIN" });
    expect(fallback.requests).toEqual([]);
    expect(configured.requests).toHaveLength(1);
  });
});
