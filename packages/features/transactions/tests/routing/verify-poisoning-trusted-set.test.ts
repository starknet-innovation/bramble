/**
 * Address-poisoning trusted set and display windows.
 *
 * Audit #242: contacts are stored zero-padded and render as `0x0` plus three
 * significant digits, so the lookalike check must compare that padded window
 * too, not only the unpadded `0x` + four digits.
 *
 * Audit #163: the trusted set covers the user's other accounts and recipients
 * this wallet itself has paid, network-scoped through `verificationContext`.
 */
import { describe, expect, test } from "bun:test";
import {
  isLookalikeAddress,
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { paddedFelt, sameFelt } from "@bramble/wallet-model/networks";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const CONTACT = "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";
const HEX = "0123456789abcdef";

const account: Pick<AccountRef, "address" | "networkId"> = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
};

const refuses = (recipient: string, preferences: Parameters<typeof verificationContext>[1]) =>
  refuseOnPoisonedRecipient(
    verifyCalls(
      [{ calldata: [recipient, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" }],
      verificationContext(account, preferences),
    ),
  ) !== null;

describe("isLookalikeAddress padded window (audit #242)", () => {
  test("every twin that renders like the padded contact is flagged", () => {
    expect(paddedFelt(CONTACT)?.slice(0, 6)).toBe("0x0555");
    for (const digit of HEX.replace("a", "")) {
      const twin = `0x0555${digit}${"0".repeat(55)}bbcc`;
      expect(sameFelt(twin, CONTACT)).toBe(false);
      expect(isLookalikeAddress(twin, CONTACT)).toBe(true);
    }
  });

  test("the contact itself, in either spelling, is not flagged", () => {
    expect(isLookalikeAddress(CONTACT, CONTACT)).toBe(false);
    expect(isLookalikeAddress(CONTACT.replace("0x0", "0x"), CONTACT)).toBe(false);
  });

  test("the existing unpadded 4+4 window still flags", () => {
    expect(isLookalikeAddress(`0x555a${"f".repeat(55)}bbcc`, CONTACT)).toBe(true);
  });

  test("an address sharing neither window is not flagged", () => {
    expect(isLookalikeAddress(`0x0556a${"0".repeat(55)}bbcc`, CONTACT)).toBe(false);
  });
});

describe("trusted set beyond the address book (audit #163)", () => {
  const PAID = "0x049d3aa7890abcdef1234567890abcdef1234567890abcdef1234567890a9f1e";
  const LOOKALIKE = "0x049d3ff111111111111111111111111111111111111111111111111111119f1e";
  const OTHER_ACCOUNT = "0x07aa11111111111111111111111111111111111111111111111111111111c0de";
  const OTHER_ACCOUNT_TWIN = "0x07aa12222222222222222222222222222222222222222222222222222222c0de";
  const base = { addressBook: [], tokens: [] };

  test("a lookalike of a recipient the wallet paid is refused", () => {
    expect(refuses(LOOKALIKE, base)).toBe(false);
    expect(
      refuses(LOOKALIKE, {
        ...base,
        paidRecipients: [{ address: PAID, networkId: "SN_MAIN" }],
      }),
    ).toBe(true);
  });

  test("paying the remembered recipient itself is not refused", () => {
    expect(
      refuses(PAID, { ...base, paidRecipients: [{ address: PAID, networkId: "SN_MAIN" }] }),
    ).toBe(false);
  });

  test("a lookalike of another of the user's accounts is refused", () => {
    expect(
      refuses(OTHER_ACCOUNT_TWIN, {
        ...base,
        ownAccounts: [{ address: OTHER_ACCOUNT, networkId: "SN_MAIN" }],
      }),
    ).toBe(true);
  });

  test("trust sources from another network are ignored", () => {
    const context = verificationContext(account, {
      ...base,
      ownAccounts: [{ address: OTHER_ACCOUNT, networkId: "SN_SEPOLIA" }],
      paidRecipients: [{ address: PAID, networkId: "SN_SEPOLIA" }],
    });
    expect(context.ownAccounts).toEqual([]);
    expect(context.recentRecipients).toEqual([]);
    expect(
      refuses(LOOKALIKE, { ...base, paidRecipients: [{ address: PAID, networkId: "SN_SEPOLIA" }] }),
    ).toBe(false);
  });

  test("the refusal names saved or paid addresses", () => {
    const report = verifyCalls(
      [{ calldata: [LOOKALIKE, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" }],
      verificationContext(account, {
        ...base,
        paidRecipients: [{ address: PAID, networkId: "SN_MAIN" }],
      }),
    );
    expect(refuseOnPoisonedRecipient(report)?.error).toContain("an address you saved or paid");
  });
});
