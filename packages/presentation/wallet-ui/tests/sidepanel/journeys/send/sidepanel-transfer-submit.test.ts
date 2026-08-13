/**
 * Route dispatch for a composed send: which preparation each route starts, the
 * copy shown when one fails, and the review synthesized from a preparation.
 *
 * The dispatch is where a route's decision becomes an actual background call, so
 * these pin the argument order per route — a deposit that dropped its recipient
 * once credited the sender while every screen reported a payment.
 */

import { describe, expect, test } from "bun:test";
import { routeFor } from "@mc-wallet/transactions/send-routes";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { PrivacyPreparation } from "../../../../src/sidepanel/journeys/privacy/privacy-runtime";
import type { TransferFields } from "../../../../src/sidepanel/journeys/send/transfer-model";
import {
  preparationFailure,
  preparationFor,
  preparedReview,
} from "../../../../src/sidepanel/journeys/send/transfer-submit";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";

const RECIPIENT = "0x02a3f4b1c5d6e7089a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071";

const account = {
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
} as unknown as AccountRef;

const fields = {
  accountId: account.id,
  amount: "1.5",
  recipient: RECIPIENT,
  tokenAddress: "0x1",
  tokenId: "SN_MAIN:STRK:0x1",
} as TransferFields;

// The recipient policy is enforced in the background, inside each preparation
// handler (MCW-V09-109), so the dispatch itself is pure routing. The stub still
// answers the panel's ordinary status/preferences reads so a future binding
// change does not fail here for an unrelated reason.
const recordingWallet = (): {
  readonly calls: readonly (readonly unknown[])[];
  readonly wallet: SidepanelWallet;
} => {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    async (...args: readonly unknown[]): Promise<never> => {
      calls.push([name, ...args]);
      return {} as never;
    };
  return {
    calls,
    wallet: {
      loadPreferences: async () => ({ addressBook: [], tokens: [] }),
      loadStatus: async () => ({ accounts: [account], networkId: "SN_MAIN" }),
      preparePrivacyDeposit: record("deposit"),
      preparePrivacyTransfer: record("transfer"),
      preparePrivacyWithdraw: record("withdraw"),
    } as unknown as SidepanelWallet,
  };
};

describe("preparationFor", () => {
  test("starts a deposit carrying the credited recipient", async () => {
    const { calls, wallet } = recordingWallet();

    await preparationFor(routeFor("public", "private"), fields, wallet);

    expect(calls).toEqual([["deposit", "SN_MAIN:STRK:0x1", "1.5", RECIPIENT]]);
  });

  // Transfer and withdraw take (tokenId, recipient, amount) while a deposit takes
  // (tokenId, amount, recipient). The orders genuinely differ, so each is pinned.
  test("starts a private transfer with the recipient before the amount", async () => {
    const { calls, wallet } = recordingWallet();

    await preparationFor(routeFor("private", "private"), fields, wallet);

    expect(calls).toEqual([["transfer", "SN_MAIN:STRK:0x1", RECIPIENT, "1.5"]]);
  });

  test("starts a withdrawal for an unshield", async () => {
    const { calls, wallet } = recordingWallet();

    await preparationFor(routeFor("private", "public"), fields, wallet);

    expect(calls).toEqual([["withdraw", "SN_MAIN:STRK:0x1", RECIPIENT, "1.5"]]);
  });

  test("prepares nothing for a plain public transfer", () => {
    const { calls, wallet } = recordingWallet();

    // A public transfer reviews through the fee estimator instead, so the
    // absence of a preparation is what routes it down the other path.
    expect(preparationFor(routeFor("public", "public"), fields, wallet)).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("preparationFailure", () => {
  test("names the leg of the move that did not happen", () => {
    expect(preparationFailure(routeFor("public", "private"))).toBe("Shielding preparation failed");
    expect(preparationFailure(routeFor("private", "public"))).toBe(
      "Unshielding preparation failed",
    );
    expect(preparationFailure(routeFor("private", "private"))).toBe(
      "Private send preparation failed",
    );
    expect(preparationFailure(routeFor("public", "public"))).toBe(
      "Private send preparation failed",
    );
  });
});

describe("preparedReview", () => {
  const preparation = {
    id: `sha256:${"a".repeat(64)}`,
    kind: "deposit",
    networkFee: { overallFee: "1", unit: "FRI" },
    payloadDigest: `sha256:${"a".repeat(64)}`,
    poolAddress: "0x123",
    route: "public-account",
    summaries: ["Shield 1.5 STRK", "Public account fee"],
    symbol: "STRK",
    tokenId: "SN_MAIN:STRK:0x1",
  } as unknown as PrivacyPreparation;

  test("carries the preparation's exact public-account network fee", () => {
    const review = preparedReview(preparation);

    expect(review).toEqual({
      fee: { overallFee: "1", unit: "FRI" },
      feeAffordability: "unknown",
      feeEstimateFailed: false,
      flags: [],
      requiresDeployment: false,
      summaries: ["Shield 1.5 STRK", "Public account fee"],
    } as unknown as ReturnType<typeof preparedReview>);
  });

  test("copies the summaries rather than aliasing the preparation's array", () => {
    const review = preparedReview(preparation);

    expect(review.summaries).not.toBe(preparation.summaries);
  });
});
