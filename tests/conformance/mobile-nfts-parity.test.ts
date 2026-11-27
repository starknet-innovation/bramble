/**
 * The mobile core's NFTs (wallet-core P17), pinned by `extension-nfts.jsonl`: discovery through
 * a saved indexer and Starkscan, the on-chain re-proof and metadata reads, the metadata
 * normaliser, the transfer calls, the watched-NFT record, and the background's discover, watch,
 * send and site watch-asset flows. This fails when the committed fixture is no longer what the
 * extension's code produces: re-run `bun run mobile:parity`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { NFTS_PARITY_FIXTURE_PATH, renderNftsParity } from "../../scripts/mobile-parity-nfts";

describe("mobile NFT parity", () => {
  test("the committed fixture is what the extension computes today", async () => {
    expect(await readFile(NFTS_PARITY_FIXTURE_PATH, "utf8")).toBe(await renderNftsParity());
  }, 60_000);
});
