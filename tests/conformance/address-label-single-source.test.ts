/**
 * Guards issue 884: addresses are cut for display by exactly one helper,
 * `addressLabel`, and every surface that once carried a private copy answers
 * identically to it. Accounts are stored canonical and contacts padded, so one
 * address reached the drawer as 0x05e1… and the review sentence as 0x5e1d…
 * until the label canonicalized first.
 *
 * Sibling of shared-helper-single-source.test.ts, which is at the file budget.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { verificationContext, verifyCalls } from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { addressLabel } from "@bramble/wallet-model/networks";
import { summarizeStrk20Action } from "../../packages/features/privacy/src/policy/summaries";
import { activityRowModel } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/activity-format";

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const PADDED = "0x05e1d3f3c9f2b3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293af2e4";
const CANONICAL = `0x${PADDED.slice(3)}`;
const account: Pick<AccountRef, "address" | "networkId"> = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
};

describe("the address label has one definition", () => {
  test("both stored spellings of one address give one label", () => {
    expect(addressLabel(PADDED)).toBe("0x5e1d…f2e4");
    expect(addressLabel(CANONICAL)).toBe("0x5e1d…f2e4");
  });

  test("the signing sentence, the Activity row, and the private summary cut it the same way", () => {
    const [review] = verifyCalls(
      [{ calldata: [PADDED, "0x1", "0x0"], contractAddress: ETH, entrypoint: "transfer" }],
      verificationContext(account, defaultWalletPreferences()),
    ).calls;
    expect(review?.summary).toContain(`to ${addressLabel(CANONICAL)}`);
    const row = activityRowModel({
      accountId: "SN_MAIN:0x1",
      counterparty: PADDED,
      direction: "out",
      hash: "0x1",
      kind: "transfer",
      networkId: "SN_MAIN",
      origin: "wallet",
      status: "accepted",
      submittedAt: 0,
      summary: "Sent 1 STRK",
    });
    expect(row.detail).toBe(`To ${addressLabel(CANONICAL)}`);
    expect(summarizeStrk20Action({ amount: "0x5", token: PADDED, type: "deposit" })).toContain(
      `(${addressLabel(CANONICAL)})`,
    );
  });
});
