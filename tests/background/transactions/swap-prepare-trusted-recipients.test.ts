/**
 * Audit #163 at swap REVIEW time: the route the user reviews is verified
 * against the same enriched trusted set (own accounts and wallet-paid
 * recipients) the execute gate re-checks, not only the address book. A
 * recipient this wallet paid that mimics the route's payee therefore raises
 * the poisoning flag on the prepared card, before anything is signed. The
 * execute-time sibling lives in recipient-trust-sources.test.ts.
 */

import { describe, expect, test } from "bun:test";
import {
  account,
  approveRouter,
  buyTokenId,
  extensionSender,
  makeSwapHarness,
  QUOTE_ID,
  routeCall,
  sellTokenId,
} from "../../support/swap-policy-harness";

// Same leading and trailing digits as the swap's payee (this account), a
// different felt: the shape the shared poisoning rule exists to catch.
const PAID_TWIN = "0x12340000000000000000000000000000000000000000000000000000000bcde";

type PreparedSwap = {
  readonly ok?: boolean;
  readonly swapPreparation?: { readonly flags: readonly { readonly code: string }[] };
};

describe("swap prepare reviews against the enriched trusted set (#163)", () => {
  test("a wallet-paid recipient mimicking the route's payee flags the prepared swap", async () => {
    const harness = makeSwapHarness([approveRouter, routeCall]);
    await harness.activity.record({
      accountId: account.id,
      counterparty: PAID_TWIN,
      hash: "0x77",
      kind: "transfer",
      networkId: "SN_MAIN",
      origin: "wallet",
      summary: "Sent 1 STRK",
    });
    const prepared = (await harness.handler(
      {
        amount: "0.01",
        buyAmount: "12.5",
        buyTokenId,
        quoteId: QUOTE_ID,
        sellTokenId,
        type: "wallet.swapPrepare",
      },
      extensionSender,
    )) as PreparedSwap;
    expect(prepared.ok).toBe(true);
    expect(prepared.swapPreparation?.flags).toContainEqual(
      expect.objectContaining({ code: "address-poisoning" }),
    );
  });
});
