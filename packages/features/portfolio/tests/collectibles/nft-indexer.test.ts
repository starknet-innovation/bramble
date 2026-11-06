/**
 * HTTP NFT indexer checks: a null endpoint skips the network, a configured one
 * parses both response envelopes and dedupes, and a non-ok/malformed response or
 * transport error resolves to an empty list marked unavailable rather than
 * throwing or claiming an empty account.
 */
import { describe, expect, test } from "bun:test";
import {
  createHttpNftIndexer,
  MAX_DISCOVERED_NFTS,
  type NftIndexerHttp,
  unavailableNftIndexer,
} from "@bramble/portfolio/nft-indexer";

const address = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const indexerUrl = "https://indexer.example/api/";

const httpReturning = (
  payload: unknown,
  ok = true,
): { readonly calls: string[]; readonly http: NftIndexerHttp } => {
  const calls: string[] = [];
  const http: NftIndexerHttp = async (url) => {
    calls.push(url);
    return { json: async () => payload, ok };
  };
  return { calls, http };
};

const record = (tokenId: string) => ({
  collection_name: "Punks",
  contract_address: "0x0511a2b3",
  image_url: "https://cdn.example/a.png",
  name: `Punk #${tokenId}`,
  token_id: tokenId,
});

describe("createHttpNftIndexer", () => {
  test("a null endpoint returns an empty list without any request", async () => {
    const { http, calls } = httpReturning([record("1")]);
    const nfts = await createHttpNftIndexer(http).listOwnedNfts({
      address,
      indexerUrl: null,
      networkId: "SN_MAIN",
    });
    expect(nfts).toEqual({ coverage: "none", nfts: [] });
    expect(calls).toEqual([]);
  });

  test("parses a bare array body and targets the documented path", async () => {
    const { http, calls } = httpReturning([record("1"), record("2")]);
    const nfts = await createHttpNftIndexer(http).listOwnedNfts({
      address,
      indexerUrl,
      networkId: "SN_MAIN",
    });
    expect(nfts.coverage).toBe("complete");
    expect(nfts.nfts.map((nft) => nft.tokenId)).toEqual(["1", "2"]);
    expect(calls[0]).toBe(`https://indexer.example/api/accounts/${address}/nfts?network=SN_MAIN`);
  });

  test("normalizes an adversarial trailing-slash run in linear time", async () => {
    const { http, calls } = httpReturning([]);
    await createHttpNftIndexer(http).listOwnedNfts({
      address,
      indexerUrl: `https://indexer.example/api${"/".repeat(8_192)}`,
      networkId: "SN_MAIN",
    });
    expect(calls[0]).toBe(`https://indexer.example/api/accounts/${address}/nfts?network=SN_MAIN`);
  });

  test("parses a { nfts: [...] } envelope, dedupes, and drops malformed records", async () => {
    const { http } = httpReturning({ nfts: [record("1"), record("1"), { token_id: "3" }] });
    const nfts = await createHttpNftIndexer(http).listOwnedNfts({
      address,
      indexerUrl,
      networkId: "SN_MAIN",
    });
    expect(nfts.nfts.map((nft) => nft.tokenId)).toEqual(["1"]);
    // A record the wallet could not read means the list may be short.
    expect(nfts.coverage).toBe("incomplete");
  });

  test("a list of only unreadable records is incomplete, not an empty account", async () => {
    const { http } = httpReturning([null]);
    expect(
      await createHttpNftIndexer(http).listOwnedNfts({ address, indexerUrl, networkId: "SN_MAIN" }),
    ).toEqual({ coverage: "incomplete", nfts: [] });
  });

  test("reports unavailable on a non-ok response, a bad body, or a transport error", async () => {
    const unavailable = { coverage: "unavailable", nfts: [] } as const;
    const notOk = createHttpNftIndexer(httpReturning([record("1")], false).http);
    expect(await notOk.listOwnedNfts({ address, indexerUrl, networkId: "SN_MAIN" })).toEqual(
      unavailable,
    );

    const badBody = createHttpNftIndexer(httpReturning("not-json-shaped").http);
    expect(await badBody.listOwnedNfts({ address, indexerUrl, networkId: "SN_MAIN" })).toEqual(
      unavailable,
    );

    const throwing = createHttpNftIndexer(async () => {
      throw new Error("network down");
    });
    expect(await throwing.listOwnedNfts({ address, indexerUrl, networkId: "SN_MAIN" })).toEqual(
      unavailable,
    );
  });

  test("caps an oversized response at MAX_DISCOVERED_NFTS to bound owner_of fan-out", async () => {
    // A hostile/large indexer returns far more candidates than the cap; each
    // candidate would otherwise cost an on-chain owner_of re-proof downstream.
    const overflow = Array.from({ length: MAX_DISCOVERED_NFTS + 25 }, (_unused, index) =>
      record(String(index + 1)),
    );
    const { http } = httpReturning(overflow);
    const nfts = await createHttpNftIndexer(http).listOwnedNfts({
      address,
      indexerUrl,
      networkId: "SN_MAIN",
    });
    expect(nfts.nfts).toHaveLength(MAX_DISCOVERED_NFTS);
    // A trimmed list is never claimed to be whole.
    expect(nfts.coverage).toBe("incomplete");
  });

  test("the unavailable indexer always returns an empty list with no coverage", async () => {
    expect(
      await unavailableNftIndexer.listOwnedNfts({ address, indexerUrl, networkId: "SN_MAIN" }),
    ).toEqual({ coverage: "none", nfts: [] });
  });

  test("Starkscan answers only when asked for and no indexer URL is saved", async () => {
    const asked: string[] = [];
    const source = async ({ address: owner }: { readonly address: string }) => {
      asked.push(owner);
      return { coverage: "incomplete", nfts: [] } as const;
    };
    const { http, calls } = httpReturning([record("1")]);
    const indexer = createHttpNftIndexer(http, source);
    // Not asked for (the preview is off), or the flag left out: nothing runs.
    expect(
      await indexer.listOwnedNfts({ address, indexerUrl: null, networkId: "SN_MAIN" }),
    ).toEqual({ coverage: "none", nfts: [] });
    expect(
      await indexer.listOwnedNfts({
        address,
        indexerUrl: null,
        networkId: "SN_MAIN",
        starkscan: false,
      }),
    ).toEqual({ coverage: "none", nfts: [] });
    expect(asked).toEqual([]);
    // Asked for: Starkscan's own answer, coverage included.
    expect(
      await indexer.listOwnedNfts({
        address,
        indexerUrl: null,
        networkId: "SN_MAIN",
        starkscan: true,
      }),
    ).toEqual({ coverage: "incomplete", nfts: [] });
    expect(asked).toEqual([address]);
    // A saved URL is the user's own choice and replaces Starkscan.
    const own = await indexer.listOwnedNfts({
      address,
      indexerUrl,
      networkId: "SN_MAIN",
      starkscan: true,
    });
    expect(own.nfts.map((nft) => nft.tokenId)).toEqual(["1"]);
    expect(asked).toEqual([address]);
    expect(calls).toHaveLength(1);
  });
});
