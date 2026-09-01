/**
 * HTTP NFT indexer checks: a null endpoint skips the network, a configured one
 * parses both response envelopes and dedupes, and a non-ok/malformed response or
 * transport error degrades to an empty list rather than throwing.
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
    expect(nfts).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("parses a bare array body and targets the documented path", async () => {
    const { http, calls } = httpReturning([record("1"), record("2")]);
    const nfts = await createHttpNftIndexer(http).listOwnedNfts({
      address,
      indexerUrl,
      networkId: "SN_MAIN",
    });
    expect(nfts.map((nft) => nft.tokenId)).toEqual(["1", "2"]);
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
    expect(nfts.map((nft) => nft.tokenId)).toEqual(["1"]);
  });

  test("degrades to empty on a non-ok response, a bad body, or a transport error", async () => {
    const notOk = createHttpNftIndexer(httpReturning([record("1")], false).http);
    expect(await notOk.listOwnedNfts({ address, indexerUrl, networkId: "SN_MAIN" })).toEqual([]);

    const badBody = createHttpNftIndexer(httpReturning("not-json-shaped").http);
    expect(await badBody.listOwnedNfts({ address, indexerUrl, networkId: "SN_MAIN" })).toEqual([]);

    const throwing = createHttpNftIndexer(async () => {
      throw new Error("network down");
    });
    expect(await throwing.listOwnedNfts({ address, indexerUrl, networkId: "SN_MAIN" })).toEqual([]);
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
    expect(nfts).toHaveLength(MAX_DISCOVERED_NFTS);
  });

  test("the unavailable indexer always returns an empty list", async () => {
    expect(
      await unavailableNftIndexer.listOwnedNfts({ address, indexerUrl, networkId: "SN_MAIN" }),
    ).toEqual([]);
  });
});
