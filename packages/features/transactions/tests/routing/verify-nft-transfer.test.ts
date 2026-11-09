/**
 * Pre-sign verification of ERC721 transfer_from calls: NFT sends must decode
 * into a human summary and run the same self-send and address-poisoning checks
 * as ERC20 transfers, keyed off the correct recipient index (calldata[1]).
 */
import { describe, expect, test } from "bun:test";
import { verifyCalls } from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { AddressBookEntry } from "@bramble/wallet-model/preferences";

const NFT_CONTRACT = "0x0511a2b3c4d5e6f7a8b9c0d1e2f30411223344556677889900aabbccddeeff00";

const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const contact: AddressBookEntry = {
  address: "0x777aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc",
  id: "SN_MAIN:0x777aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc",
  label: "Ada",
  networkId: "SN_MAIN",
};

const context = { account, addressBook: [contact], tokens: [] };

describe("verifyCalls for ERC721 transfer_from", () => {
  test("decodes transfer_from into a human NFT summary", () => {
    const report = verifyCalls(
      [
        {
          calldata: [account.address, contact.address, "5", "0"],
          contractAddress: NFT_CONTRACT,
          entrypoint: "transfer_from",
        },
      ],
      context,
    );

    expect(report.calls[0]?.kind).toBe("transfer");
    expect(report.calls[0]?.summary).toContain("Send NFT #5 to");
  });

  test("flags a poisoned recipient (calldata[1], not the from field)", () => {
    const poisoned = "0x777aa7890abcdef9999999999999999999999999999999999999990aabbcc";
    const report = verifyCalls(
      [
        {
          // from = a saved contact, to = a lookalike of that contact.
          calldata: [contact.address, poisoned, "5", "0"],
          contractAddress: NFT_CONTRACT,
          entrypoint: "transfer_from",
        },
      ],
      context,
    );

    expect(report.flags.map((flag) => flag.code)).toContain("address-poisoning");
  });

  test("does not flag poisoning when only the from field is a lookalike", () => {
    const poisoned = "0x777aa7890abcdef9999999999999999999999999999999999999990aabbcc";
    const report = verifyCalls(
      [
        {
          // from = lookalike, to = the genuine contact: nothing to poison.
          calldata: [poisoned, contact.address, "5", "0"],
          contractAddress: NFT_CONTRACT,
          entrypoint: "transfer_from",
        },
      ],
      context,
    );

    expect(report.flags.map((flag) => flag.code)).not.toContain("address-poisoning");
  });

  test("flags an NFT sent back to the wallet's own address", () => {
    const report = verifyCalls(
      [
        {
          calldata: [account.address, account.address, "5", "0"],
          contractAddress: NFT_CONTRACT,
          entrypoint: "transfer_from",
        },
      ],
      context,
    );

    expect(report.flags.map((flag) => flag.code)).toContain("self-transfer");
  });
});

describe("verifyCalls for ERC1155 safe_transfer_from", () => {
  test("decodes the token, amount, and recipient", () => {
    const report = verifyCalls(
      [
        {
          calldata: [account.address, contact.address, "342", "0", "1", "0", "0"],
          contractAddress: NFT_CONTRACT,
          entrypoint: "safe_transfer_from",
        },
      ],
      context,
    );

    expect(report.calls[0]?.kind).toBe("transfer");
    expect(report.calls[0]?.summary).toContain("Send 1 of NFT #342 to");
  });

  test("applies the address-poisoning gate to the ERC1155 recipient", () => {
    const poisoned = "0x777aa7890abcdef9999999999999999999999999999999999999990aabbcc";
    const report = verifyCalls(
      [
        {
          calldata: [account.address, poisoned, "342", "0", "1", "0", "0"],
          contractAddress: NFT_CONTRACT,
          entrypoint: "safeTransferFrom",
        },
      ],
      context,
    );

    expect(report.flags.map((flag) => flag.code)).toContain("address-poisoning");
  });
});
