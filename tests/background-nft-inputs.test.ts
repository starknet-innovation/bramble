/**
 * NFT gallery message parser checks reject wrong-type envelopes and out-of-range
 * labels before an add-NFT request reaches ownership verification.
 */
import { describe, expect, test } from "bun:test";
import { readAddNftInput } from "../src/background/nft-inputs";

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
