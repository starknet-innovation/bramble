/**
 * Verification module checks: calldata decoding, risk flags, and
 * address-poisoning detection stay pure and predictable.
 */
import { describe, expect, test } from "bun:test";
import { isLookalikeAddress, verifyCalls } from "../src/starknet/verify";
import type { AddressBookEntry, TokenConfig } from "../src/storage/preferences-store";
import type { AccountRef } from "../src/storage/vault-schema";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const account: AccountRef = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const tokens: readonly TokenConfig[] = [
  {
    address: ETH,
    decimals: 18,
    id: `SN_MAIN:ETH:${ETH}`,
    name: "Ether",
    networkId: "SN_MAIN",
    symbol: "ETH",
  },
];

const contact: AddressBookEntry = {
  address: "0x777aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc",
  id: "SN_MAIN:0x777aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc",
  label: "Ada",
  networkId: "SN_MAIN",
};

const context = { account, addressBook: [contact], tokens };

describe("verifyCalls", () => {
  test("decodes known ERC20 transfers into a human summary", () => {
    const report = verifyCalls(
      [
        {
          calldata: [contact.address, "1500000000000000000", "0"],
          contractAddress: ETH,
          entrypoint: "transfer",
        },
      ],
      context,
    );

    expect(report.calls[0]?.kind).toBe("transfer");
    expect(report.calls[0]?.summary).toContain("Send 1.5 ETH to");
    expect(report.flags).toEqual([]);
  });

  test("flags unlimited approvals and unknown contracts", () => {
    const unlimited = (1n << 251n).toString();
    const report = verifyCalls(
      [
        {
          calldata: ["0x999", unlimited, "0"],
          contractAddress: "0x6b17d1f2e12c4247f8bce6e563a40f2275d5e88540f0e9899d9ecfeeb8e0aff",
          entrypoint: "approve",
        },
      ],
      context,
    );

    const codes = report.flags.map((flag) => flag.code);
    expect(codes).toContain("unlimited-approval");
    expect(codes).toContain("unknown-contract");
    expect(report.calls[0]?.kind).toBe("approve");
  });

  test("flags transfers back to the sender's own account", () => {
    const report = verifyCalls(
      [
        {
          calldata: [account.address, "1", "0"],
          contractAddress: ETH,
          entrypoint: "transfer",
        },
      ],
      context,
    );

    expect(report.flags.map((flag) => flag.code)).toContain("self-transfer");
  });

  test("flags address poisoning against saved contacts", () => {
    const poisoned = "0x777aa7890abcdef9999999999999999999999999999999999999990aabbcc";
    const report = verifyCalls(
      [
        {
          calldata: [poisoned, "1", "0"],
          contractAddress: ETH,
          entrypoint: "transfer",
        },
      ],
      context,
    );

    expect(report.flags.map((flag) => flag.code)).toContain("address-poisoning");
  });

  test("summarizes unknown entrypoints without guessing", () => {
    const report = verifyCalls(
      [{ calldata: ["0x1"], contractAddress: "0x123456789abcdef1122", entrypoint: "upgrade" }],
      context,
    );

    expect(report.calls[0]?.kind).toBe("unknown");
    expect(report.calls[0]?.summary).toContain("Call upgrade on");
  });
});

describe("isLookalikeAddress", () => {
  test("detects same-ends different-middle addresses", () => {
    expect(
      isLookalikeAddress(
        "0x777aa7890abcdef9999999999999999999999999999999999999990aabbcc",
        contact.address,
      ),
    ).toBe(true);
  });

  test("accepts identical and unrelated addresses", () => {
    expect(isLookalikeAddress(contact.address, contact.address)).toBe(false);
    expect(
      isLookalikeAddress("0x9998887771112223334445556667778889990001112223334445", contact.address),
    ).toBe(false);
    expect(isLookalikeAddress("0x1", contact.address)).toBe(false);
  });
});
