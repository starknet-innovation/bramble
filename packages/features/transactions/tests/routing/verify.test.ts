/**
 * Verification module checks: calldata decoding, risk flags, and
 * address-poisoning detection stay pure and predictable.
 */
import { describe, expect, test } from "bun:test";
import { isLookalikeAddress, verifyCalls } from "@mc-wallet/transactions/verify";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { AddressBookEntry, TokenConfig } from "@mc-wallet/wallet-model/preferences";

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

// A canonical effectively-unlimited allowance: the `(low, high)` limbs of the
// maximum u256, each inside the u128 range Cairo can actually deserialize. The
// spelling matters — see the non-canonical case below.
const UNLIMITED_U256_LIMBS = [
  ((1n << 128n) - 1n).toString(),
  ((1n << 128n) - 1n).toString(),
] as const;

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
    const report = verifyCalls(
      [
        {
          calldata: ["0x999", ...UNLIMITED_U256_LIMBS],
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

  test("does not read a non-canonical uint256 as an approval amount", () => {
    // `(2^251, 0)` is not a uint256 any Cairo entrypoint can deserialize — the
    // low limb is outside u128, so the call reverts before it moves anything.
    // The shared join therefore refuses it, and the reviewer shows an
    // undecodable call rather than inventing a 2^251 allowance the token would
    // never grant. Reading it as an amount let calldata that cannot execute
    // drive the review screen's numbers.
    const report = verifyCalls(
      [
        {
          calldata: ["0x999", (1n << 251n).toString(), "0"],
          contractAddress: ETH,
          entrypoint: "approve",
        },
      ],
      context,
    );

    expect(report.flags.map((flag) => flag.code)).not.toContain("unlimited-approval");
    expect(report.calls[0]?.kind).toBe("unknown");
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

  test("decodes the camelCase transferFrom dual identically to snake_case", () => {
    // ERC20/ERC721 contracts expose transfer_from under both the snake_case
    // Cairo name and its camelCase dual; the boundary accepts either. A
    // camelCase `transferFrom` must decode to the same amount and raise the same
    // risk flags — otherwise it falls through to "unknown" and a poisoned or
    // self recipient sent via the camelCase spelling would evade every warning.
    const call = (entrypoint: string) => ({
      calldata: [contact.address, account.address, "1500000000000000000", "0"],
      contractAddress: ETH,
      entrypoint,
    });
    const snake = verifyCalls([call("transfer_from")], context);
    const camel = verifyCalls([call("transferFrom")], context);

    expect(camel.calls[0]?.kind).toBe("transfer");
    // Same decoded value and same flag set as the snake_case spelling.
    expect(camel.calls[0]?.summary).toBe(snake.calls[0]?.summary);
    expect(camel.calls[0]?.summary).toContain("Send 1.5 ETH");
    expect(camel.flags.map((flag) => flag.code)).toEqual(snake.flags.map((flag) => flag.code));
    expect(camel.flags.map((flag) => flag.code)).toContain("self-transfer");
  });

  test("flags address-poisoning on a camelCase transferFrom recipient", () => {
    // The recipient sits at calldata[1] for transfer_from regardless of casing;
    // the recipient-index flag logic must recognize the camelCase dual too.
    const poisoned = `${account.address.slice(0, 8)}ffffffffffffffffffffffffffffffffffffffffffffffffffff${account.address.slice(-4)}`;
    const report = verifyCalls(
      [
        {
          calldata: [account.address, poisoned, "1000000000000000000", "0"],
          contractAddress: ETH,
          entrypoint: "transferFrom",
        },
      ],
      context,
    );

    expect(report.calls[0]?.kind).toBe("transfer");
    expect(report.flags.map((flag) => flag.code)).toContain("address-poisoning");
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
    const otherContract = "0xcccc000000000000000000000000000000000000000000000000000000000003";
    const report = verifyCalls(
      [
        {
          calldata: ["0x111", ...UNLIMITED_U256_LIMBS],
          contractAddress: otherContract,
          entrypoint: "approve",
        },
        {
          calldata: ["0x222", ...UNLIMITED_U256_LIMBS],
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
    // The card displays four hex digits at the front. Matching only those four
    // must be enough to refuse, even when the next two differ.
    expect(
      isLookalikeAddress(
        "0x777affffffffffffffffffffffffffffffffffffffffffffffffffffaabbcc",
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
