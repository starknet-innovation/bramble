/**
 * The default indexer is Starkscan through the SNF gateway route: a saved URL
 * equal to that route is read with Starkscan's schema, on Mainnet only, with
 * one request that carries only the canonical address; a failure is
 * "unavailable" and a partial index "incomplete". Fixtures are schema-derived,
 * not a live capture.
 */
import { describe, expect, test } from "bun:test";
import { HTTP_BODY_LIMITS } from "@bramble/core/http-json";
import {
  createHttpNftIndexer,
  DEFAULT_NFT_INDEXER_URL,
  type NftIndexerHttp,
} from "@bramble/portfolio/nft-indexer";
import { STARKSCAN_NFT_ROUTE } from "@bramble/portfolio/starkscan-nft-positions";
import {
  STARKSCAN_OWNER,
  starkscanCoverage,
  starkscanPage,
} from "../support/starkscan-nft-fixture";

const ROUTE = "https://gateway.example/starkscan/nft";

const recording = (payload: unknown, ok = true) => {
  const calls: Array<{ readonly init: RequestInit; readonly url: string }> = [];
  const http: NftIndexerHttp = async (url, init) => {
    calls.push({ init, url });
    return { json: async () => payload, ok };
  };
  return { calls, http };
};

const list = (http: NftIndexerHttp, networkId: "SN_MAIN" | "SN_SEPOLIA" = "SN_MAIN") =>
  createHttpNftIndexer(http, ROUTE).listOwnedNfts({
    address: STARKSCAN_OWNER,
    indexerUrl: `${ROUTE}/`,
    networkId,
  });

describe("Starkscan NFT discovery through the gateway", () => {
  test("ships with no route, so no default indexer is offered", () => {
    expect(STARKSCAN_NFT_ROUTE).toBeNull();
    expect(DEFAULT_NFT_INDEXER_URL).toBeNull();
  });

  test("one request carrying only the canonical address and the page size", async () => {
    const { calls, http } = recording(starkscanPage());
    const result = await list(http);
    expect(result.coverage).toBe("complete");
    expect(result.nfts.map((nft) => nft.tokenId)).toEqual(["1", "2"]);
    expect(calls.map((call) => call.url)).toEqual([
      `${ROUTE}/0x${BigInt(STARKSCAN_OWNER).toString(16)}/nft-positions?limit=100`,
    ]);
    expect(calls[0]?.init.headers).toBeUndefined();
    expect(calls[0]?.init.redirect).toBe("error");
    expect(calls[0]?.init.credentials).toBe("omit");
  });

  test("Sepolia never contacts the route and reports no discovery", async () => {
    const { calls, http } = recording(starkscanPage());
    expect(await list(http, "SN_SEPOLIA")).toEqual({ coverage: "none", nfts: [] });
    expect(calls).toEqual([]);
  });

  test("a partial index is incomplete, with its candidates kept", async () => {
    const partial = starkscanPage(undefined, {
      coverage: starkscanCoverage({ status: "partial" }),
    });
    const result = await list(recording(partial).http);
    expect(result.coverage).toBe("incomplete");
    expect(result.nfts).toHaveLength(2);
  });

  test("a gateway error, a malformed page or another owner is unavailable", async () => {
    const unavailable = { coverage: "unavailable", nfts: [] } as const;
    expect(await list(recording(starkscanPage(), false).http)).toEqual(unavailable);
    expect(await list(recording({ items: [] }).http)).toEqual(unavailable);
    expect(await list(recording(starkscanPage(undefined, { ownerAddress: "0x999" })).http)).toEqual(
      unavailable,
    );
    const throwing: NftIndexerHttp = async () => {
      throw new Error("offline");
    };
    expect(await list(throwing)).toEqual(unavailable);
  });

  test("a legacy-shaped body on the route is refused, not read as the old contract", async () => {
    const legacy = [{ contract_address: "0x511a2b3", token_id: "1" }];
    expect(await list(recording(legacy).http)).toEqual({ coverage: "unavailable", nfts: [] });
  });

  test("an oversized page is cut off at its own budget", async () => {
    // A valid page that declares more than the positions budget (but less
    // than the general indexer one) is refused, so the tighter cap applies.
    const huge = new Response(JSON.stringify(starkscanPage()), {
      headers: { "content-length": String(HTTP_BODY_LIMITS.nftPositions + 1) },
    });
    expect(await list(async () => huge)).toEqual({ coverage: "unavailable", nfts: [] });
  });

  test("any other saved URL keeps the documented indexer contract", async () => {
    const { calls, http } = recording(starkscanPage());
    const result = await createHttpNftIndexer(http, ROUTE).listOwnedNfts({
      address: STARKSCAN_OWNER,
      indexerUrl: "https://mine.example",
      networkId: "SN_MAIN",
    });
    expect(calls[0]?.url).toBe(
      `https://mine.example/accounts/${STARKSCAN_OWNER}/nfts?network=SN_MAIN`,
    );
    // A Starkscan page is not the documented contract's shape.
    expect(result).toEqual({ coverage: "unavailable", nfts: [] });
  });
});
