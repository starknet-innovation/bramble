/**
 * ERC721/ERC1155 helper checks: transfer calldata construction and address
 * validation.
 */
import { describe, expect, test } from "bun:test";
import { buildErc721TransferCall, buildErc1155TransferCall } from "../../src/starknet/nft";

describe("ERC721 transfer call", () => {
  test("builds transfer_from calldata with a u256 token id", () => {
    expect(buildErc721TransferCall("0x3", "0x1", "0x2", 5n)).toEqual({
      calldata: ["1", "2", "5", "0"],
      contractAddress: "0x3",
      entrypoint: "transfer_from",
    });
  });

  test("allows token id zero", () => {
    expect(buildErc721TransferCall("0x3", "0x1", "0x2", 0n).calldata).toEqual(["1", "2", "0", "0"]);
  });

  test("rejects zero contract, sender, or recipient", () => {
    expect(() => buildErc721TransferCall("0x0", "0x1", "0x2", 1n)).toThrow(
      "Invalid NFT transfer address",
    );
    expect(() => buildErc721TransferCall("0x3", "0x1", "0x0", 1n)).toThrow(
      "Invalid NFT transfer address",
    );
  });
});

describe("ERC1155 transfer call", () => {
  test("builds a one-edition safe_transfer_from with empty data", () => {
    expect(buildErc1155TransferCall("0x3", "0x1", "0x2", 342n)).toEqual({
      calldata: ["1", "2", "342", "0", "1", "0", "0"],
      contractAddress: "0x3",
      entrypoint: "safe_transfer_from",
    });
  });
});
