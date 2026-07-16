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

  test("decodes a known-token transfer_from as an ERC20 amount, not an NFT id", () => {
    // ERC20 and ERC721 share the transfer_from selector and 4-felt arity; on a
    // token the wallet knows the third/fourth felts are an amount. Mislabeling
    // this "Send NFT #1500000000000000000" would hide the real value moved.
    const report = verifyCalls(
      [
        {
          calldata: [contact.address, account.address, "1500000000000000000", "0"],
          contractAddress: ETH,
          entrypoint: "transfer_from",
        },
      ],
      context,
    );

    expect(report.calls[0]?.kind).toBe("transfer");
    expect(report.calls[0]?.summary).toContain("Send 1.5 ETH");
    expect(report.calls[0]?.summary).not.toContain("NFT");
    // The recipient is calldata[1] (the account itself here), so the self-send
    // check still runs on the disambiguated transfer.
    expect(report.flags.map((flag) => flag.code)).toContain("self-transfer");
  });

  test("keeps a distinct unknown-contract flag for each contract in a multicall", () => {
    const first = "0xaaaa000000000000000000000000000000000000000000000000000000000001";
    const second = "0xbbbb000000000000000000000000000000000000000000000000000000000002";
    const report = verifyCalls(
      [
        { calldata: [], contractAddress: first, entrypoint: "foo" },
        { calldata: [], contractAddress: second, entrypoint: "bar" },
      ],
      context,
    );

    const unknownFlags = report.flags.filter((flag) => flag.code === "unknown-contract");
    // Both distinct contracts must surface — collapsing by code alone would hide
    // the second, under-warning the user about a multicall's later contracts.
    expect(unknownFlags).toHaveLength(2);
    expect(unknownFlags.some((flag) => flag.message.includes("0xaaaa"))).toBe(true);
    expect(unknownFlags.some((flag) => flag.message.includes("0xbbbb"))).toBe(true);
  });

  test("still collapses identical risk lines from a multicall", () => {
    // Two effectively-unlimited approvals to different spenders on the same
    // unknown contract raise the same generic unlimited-approval line; that line
    // is deduped to one, while the two calls keep one unknown-contract flag each
    // for the same address (identical message → collapsed).
    const unlimited = (1n << 251n).toString();
    const otherContract = "0xcccc000000000000000000000000000000000000000000000000000000000003";
    const report = verifyCalls(
      [
        {
          calldata: ["0x111", unlimited, "0"],
          contractAddress: otherContract,
          entrypoint: "approve",
        },
        {
          calldata: ["0x222", unlimited, "0"],
          contractAddress: otherContract,
          entrypoint: "approve",
        },
      ],
      context,
    );

    expect(report.flags.filter((flag) => flag.code === "unlimited-approval")).toHaveLength(1);
    expect(report.flags.filter((flag) => flag.code === "unknown-contract")).toHaveLength(1);
  });

  test("falls back to a generic summary when transfer_from calldata is malformed", () => {
    // A transfer_from whose recipient/amount felts do not decode must not throw
    // or guess — it falls through to the safe "Call <entrypoint>" summary. The
    // dApp boundary rejects non-felt calldata, so this only happens defensively,
    // but the decoder must stay total (parse, don't validate).
    const report = verifyCalls(
      [
        {
          calldata: [account.address, 42 as unknown as string, "5", "0"],
          contractAddress: ETH,
          entrypoint: "transfer_from",
        },
      ],
      context,
    );

    expect(report.calls[0]?.kind).toBe("unknown");
    expect(report.calls[0]?.summary).toContain("Call transfer_from on");
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
