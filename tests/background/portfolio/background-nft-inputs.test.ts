/**
 * NFT gallery message parser checks reject wrong-type envelopes and out-of-range
 * labels before an add-NFT request reaches ownership verification.
 */
import { describe, expect, test } from "bun:test";
import {
  readAddNftInput,
  readDiscoverNftsInput,
  readReviewNftTransferInput,
  readTransferNftInput,
} from "../../../apps/extension/src/background/portfolio/nft-inputs";

const contract = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

describe("readAddNftInput", () => {
  test("reads a well-formed add-NFT request with a trimmed label", () => {
    expect(
      readAddNftInput({
        contract,
        label: "  Genesis  ",
        networkId: "SN_MAIN",
        tokenId: "42",
        type: "wallet.addNft",
      }),
    ).toEqual({ contract, label: "Genesis", networkId: "SN_MAIN", tokenId: "42" });
  });

  test("rejects a non-record or wrong-type envelope", () => {
    expect(readAddNftInput("nope")).toBeNull();
    expect(
      readAddNftInput({ contract, networkId: "SN_MAIN", tokenId: "42", type: "wallet.removeNft" }),
    ).toBeNull();
    expect(
      readAddNftInput({
        contract,
        debug: true,
        networkId: "SN_MAIN",
        tokenId: "42",
        type: "wallet.addNft",
      }),
    ).toBeNull();
  });

  test("rejects a blank, over-long, or non-string label", () => {
    expect(
      readAddNftInput({
        contract,
        label: "   ",
        networkId: "SN_MAIN",
        tokenId: "42",
        type: "wallet.addNft",
      }),
    ).toBeNull();
    expect(
      readAddNftInput({
        contract,
        label: "L".repeat(65),
        networkId: "SN_MAIN",
        tokenId: "42",
        type: "wallet.addNft",
      }),
    ).toBeNull();
    expect(
      readAddNftInput({
        contract,
        label: 123,
        networkId: "SN_MAIN",
        tokenId: "42",
        type: "wallet.addNft",
      }),
    ).toBeNull();
  });
});

describe("NFT transfer inputs", () => {
  const fields = {
    contract,
    networkId: "SN_MAIN" as const,
    recipient: "0x123",
    tokenId: "42",
  };

  test("keeps review and submit envelopes distinct while parsing the same fields", () => {
    expect(readReviewNftTransferInput({ ...fields, type: "wallet.reviewNftTransfer" })).toEqual(
      fields,
    );
    expect(readTransferNftInput({ ...fields, type: "wallet.transferNft" })).toEqual(fields);
    expect(readReviewNftTransferInput({ ...fields, type: "wallet.transferNft" })).toBeNull();
    expect(readTransferNftInput({ ...fields, type: "wallet.reviewNftTransfer" })).toBeNull();
  });

  test("rejects malformed recipients and unexpected fields in both phases", () => {
    expect(
      readReviewNftTransferInput({
        ...fields,
        recipient: "not-an-address",
        type: "wallet.reviewNftTransfer",
      }),
    ).toBeNull();
    expect(readTransferNftInput({ ...fields, debug: true, type: "wallet.transferNft" })).toBeNull();
  });
});

describe("readDiscoverNftsInput", () => {
  test("defaults to a complete response and accepts the indexed-only fast path", () => {
    expect(readDiscoverNftsInput({ type: "wallet.discoverNfts" })).toEqual({
      includeWatched: true,
    });
    expect(readDiscoverNftsInput({ includeWatched: false, type: "wallet.discoverNfts" })).toEqual({
      includeWatched: false,
    });
    expect(
      readDiscoverNftsInput({
        multisigId: "SN_MAIN:0x456",
        type: "wallet.discoverNfts",
      }),
    ).toEqual({
      includeWatched: true,
      multisigId: "SN_MAIN:0x456",
    });
  });

  test("rejects unknown keys and non-boolean modes", () => {
    expect(readDiscoverNftsInput({ extra: true, type: "wallet.discoverNfts" })).toBeNull();
    expect(readDiscoverNftsInput({ includeWatched: "no", type: "wallet.discoverNfts" })).toBeNull();
    expect(readDiscoverNftsInput({ multisigId: "", type: "wallet.discoverNfts" })).toBeNull();
  });
});
