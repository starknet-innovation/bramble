/**
 * Audit #163: only rows this wallet recorded for its own submissions feed the
 * poisoning check's "recipients you paid" set. A chain-discovered row — which a
 * third party can plant — and a legacy row without provenance contribute
 * nothing, so a planted lookalike can never become trusted itself.
 */
import { describe, expect, test } from "bun:test";
import { type ActivityEntry, isActivityEntry } from "@bramble/transactions/activity";
import {
  MAX_PAID_RECIPIENTS_PER_NETWORK,
  walletPaidRecipients,
} from "@bramble/transactions/paid-recipients";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const row = (overrides: Partial<ActivityEntry>): ActivityEntry => ({
  accountId: `SN_MAIN:${ACCOUNT}`,
  counterparty: "0x0abc",
  hash: "0x1",
  kind: "transfer",
  networkId: "SN_MAIN",
  origin: "wallet",
  status: "accepted",
  submittedAt: 1,
  summary: "Sent 1 ETH",
  ...overrides,
});

describe("walletPaidRecipients", () => {
  test("keeps wallet-origin transfer counterparties, canonical and de-duplicated", () => {
    expect(
      walletPaidRecipients([
        row({ counterparty: "0x0000abc", submittedAt: 2 }),
        row({ counterparty: "0xABC", hash: "0x2" }),
      ]),
    ).toEqual([{ address: "0xabc", networkId: "SN_MAIN" }]);
  });

  test("keeps the payee of a wallet-origin NFT or multisig send (an invoke row)", () => {
    expect(walletPaidRecipients([row({ counterparty: "0xdef", kind: "invoke" })])).toEqual([
      { address: "0xdef", networkId: "SN_MAIN" },
    ]);
  });

  test("ignores chain-discovered, legacy, counterparty-less, and zero counterparties", () => {
    const { origin: _legacy, ...legacy } = row({});
    const { counterparty: _none, ...withoutCounterparty } = row({ kind: "invoke" });
    expect(
      walletPaidRecipients([
        legacy,
        withoutCounterparty,
        row({ counterparty: "0x0" }),
        row({ counterparty: "not-a-felt" }),
      ]),
    ).toEqual([]);
  });

  test("caps each network at the newest recipients", () => {
    const rows = Array.from({ length: MAX_PAID_RECIPIENTS_PER_NETWORK + 5 }, (_, index) =>
      row({ counterparty: `0x${(index + 1).toString(16)}`, submittedAt: index }),
    );
    const paid = walletPaidRecipients(rows);
    expect(paid).toHaveLength(MAX_PAID_RECIPIENTS_PER_NETWORK);
    expect(paid[0]?.address).toBe(`0x${(MAX_PAID_RECIPIENTS_PER_NETWORK + 5).toString(16)}`);
  });
});

describe("activity origin field", () => {
  test("validates only the wallet marker", () => {
    expect(isActivityEntry(row({}))).toBe(true);
    expect(isActivityEntry({ ...row({}), origin: "chain" })).toBe(false);
    const { origin: _absent, ...legacy } = row({});
    expect(isActivityEntry(legacy)).toBe(true);
  });
});
