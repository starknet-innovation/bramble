/**
 * Starkscan NFT positions reader: a schema-shaped page yields canonical
 * candidates; anything structurally wrong refuses the whole page; only a ready,
 * in-scope, single page counts as complete; and only Mainnet is read. Fixtures
 * are schema-derived, not a live capture (see the support module).
 */
import { describe, expect, test } from "bun:test";
import {
  parseStarkscanNftPage,
  STARKSCAN_NFT_PAGE_SIZE,
  starkscanNftPositionsUrl,
} from "@bramble/portfolio/starkscan-nft-positions";
import {
  STARKSCAN_COLLECTION,
  STARKSCAN_OWNER,
  starkscanCoverage,
  starkscanPage,
  starkscanPosition,
} from "../support/starkscan-nft-fixture";

const parse = (body: unknown, owner = STARKSCAN_OWNER) =>
  parseStarkscanNftPage(body, owner, "SN_MAIN");

describe("parseStarkscanNftPage", () => {
  test("reads a schema-shaped page into canonical candidates", () => {
    const page = parse(starkscanPage());
    expect(page?.coverage).toBe("complete");
    expect(page?.nfts).toEqual([
      {
        collection: "Punks",
        contract: STARKSCAN_COLLECTION,
        id: `SN_MAIN:${STARKSCAN_COLLECTION}:1`,
        image: "",
        name: "",
        networkId: "SN_MAIN",
        tokenId: "1",
      },
      expect.objectContaining({ tokenId: "2" }),
    ]);
  });

  test("canonicalises hex token ids and contract case", () => {
    const page = parse(starkscanPage([starkscanPosition("0xff", { tokenAddress: "0x0511A2B3" })]));
    expect(page?.nfts[0]?.tokenId).toBe("255");
    expect(page?.nfts[0]?.contract).toBe(STARKSCAN_COLLECTION);
  });

  test("an empty, complete page is a real empty answer", () => {
    expect(parse(starkscanPage([]))).toEqual({ coverage: "complete", nfts: [] });
  });

  test("ignores fields the wallet does not read", () => {
    expect(parse(starkscanPage(undefined, { futureField: { any: 1 } }))?.nfts).toHaveLength(2);
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
      test(name, () => {
        const page = parse(starkscanPage([], overrides));
        expect(page).toEqual({ coverage: "incomplete", nfts: [] });
      });
    }
  });

  describe("refuses the whole page", () => {
    const many = Array.from({ length: STARKSCAN_NFT_PAGE_SIZE + 1 }, (_unused, index) =>
      starkscanPosition(String(index + 1)),
    );
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ["a non-object body", []],
      ["another schema version", starkscanPage(undefined, { schemaVersion: "v2" })],
      ["another chain", starkscanPage(undefined, { chainId: "SN_SEPOLIA" })],
      ["another owner", starkscanPage(undefined, { ownerAddress: "0x999" })],
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
      ["a zero contract", starkscanPage([starkscanPosition("1", { tokenAddress: "0x0" })])],
      ["a non-felt contract", starkscanPage([starkscanPosition("1", { tokenAddress: "0xzz" })])],
      ["a token id past u256", starkscanPage([starkscanPosition((1n << 256n).toString())])],
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
      ["a duplicate position", starkscanPage([starkscanPosition("1"), starkscanPosition("0x1")])],
    ];
    for (const [name, body] of cases) {
      test(name, () => {
        expect(parse(body)).toBeNull();
      });
    }
  });

  test("a hostile collection name is dropped, not allowed to refuse the page", () => {
    const named = (name: unknown) =>
      starkscanPosition("1", { collection: { metadataStatus: "indexed", name, symbol: null } });
    for (const name of ["Punks\u202Eevil", "a\u0007b", "Punks\u061C", "x".repeat(65)]) {
      expect(parse(starkscanPage([named(name)]))?.nfts[0]?.collection).toBe("");
    }
    expect(parse(starkscanPage([named(null)]))?.nfts[0]?.collection).toBe("");
    const unindexed = starkscanPosition("1", {
      collection: { metadataStatus: "unavailable", name: "Stale", symbol: null },
    });
    expect(parse(starkscanPage([unindexed]))?.nfts[0]?.collection).toBe("");
  });

  test("never reads a page for a network other than Mainnet", () => {
    expect(parseStarkscanNftPage(starkscanPage(), STARKSCAN_OWNER, "SN_SEPOLIA")).toBeNull();
  });

  test("the request carries only the address and the page size", () => {
    expect(starkscanNftPositionsUrl("https://gw.example/starkscan/nft//", "0xabc")).toBe(
      `https://gw.example/starkscan/nft/0xabc/nft-positions?limit=${STARKSCAN_NFT_PAGE_SIZE}`,
    );
  });
});
