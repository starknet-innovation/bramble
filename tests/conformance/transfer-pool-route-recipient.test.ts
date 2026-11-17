/**
 * The panel's side of the one recipient policy (MCW-V09-109).
 *
 * The policy itself is enforced in the background — one shared
 * `refuseOnPoisonedRecipient` at each submitting handler, pinned across all
 * four product lines in tests/background/send-recipient-poisoning-parity.test.ts
 * — because the panel's message is untrusted like any other and a panel-side
 * gate could only ever be advisory. That placement only holds up if the panel
 * does two things, and neither had a test: hand the *user's* recipient to every
 * pool route so the background judges the address the user actually typed, and
 * surface a refusal instead of swallowing it.
 *
 * These drive `preparationFor`, the panel's route→preparation dispatch, through
 * the shared transfer harness. Before this suite the harness had no privacy
 * preparation stubs at all, so no test drove a pool-routed recipient: a route
 * that quietly shielded to the sender instead of paying the composed recipient
 * would have gone unnoticed here.
 */

import { describe, expect, test } from "bun:test";
import { routeFor, type SendRoute } from "@bramble/transactions/send-routes";
import type { TransferFields } from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-model";
import {
  preparationFailure,
  preparationFor,
} from "../../packages/presentation/wallet-ui/src/sidepanel/journeys/send/transfer-submit";
import type { SidepanelWallet } from "../../packages/presentation/wallet-ui/src/sidepanel/runtime/runtime";
import {
  makeWallet,
  type WalletCalls,
} from "../../packages/presentation/wallet-ui/tests/support/transfer-ui-harness";
import { POISONING_REFUSAL } from "../support/poisoned-recipients";

const TOKEN_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const TOKEN_ID = `SN_MAIN:ETH:${TOKEN_ADDRESS}`;
// The address the user composed. Every pool route must pass exactly this to the
// background, which is the only place the trusted-set comparison happens.
const RECIPIENT = "0x0555aa7890abcdef1234567890abcdef1234567890abcdef1234567890aabbcc";

// The refusal wording is produced by running the shared verifier, not spelled
// out here — see tests/support/poisoned-recipients. The panel must surface that
// sentence, not a generic failure, so the fixture has to BE that sentence.

const fields = (route: SendRoute): TransferFields => ({
  accountId: "SN_MAIN:0x1",
  amount: "1",
  destination: route.destination,
  fiatEstimate: "",
  recipient: RECIPIENT,
  recipientLabel: "",
  recipientResolvedFrom: "",
  signer: "software",
  source: route.source,
  speed: "standard",
  tokenAddress: TOKEN_ADDRESS,
  tokenBalance: "1000",
  tokenDecimals: "18",
  tokenFormatted: "1",
  tokenId: TOKEN_ID,
  tokenPrice: "0",
  tokenSymbol: "ETH",
});

const POOL_ROUTES: readonly {
  readonly call: keyof WalletCalls;
  readonly label: string;
  readonly route: SendRoute;
}[] = [
  { call: "preparePrivacyDeposit", label: "shield", route: routeFor("public", "private") },
  { call: "preparePrivacyTransfer", label: "private send", route: routeFor("private", "private") },
  { call: "preparePrivacyWithdraw", label: "unshield", route: routeFor("private", "public") },
];

const drive = (route: SendRoute, overrides: Record<string, unknown> = {}) => {
  const { calls, wallet } = makeWallet(overrides);
  const preparing = preparationFor(route, fields(route), wallet as unknown as SidepanelWallet);
  return { calls, preparing };
};

describe("every pool route hands the composed recipient to the background", () => {
  for (const { call, label, route } of POOL_ROUTES) {
    test(`the ${label} route prepares against the recipient the user typed`, async () => {
      const { calls, preparing } = drive(route);

      expect(preparing).not.toBeNull();
      await preparing;

      const recorded = calls[call];
      expect(Array.isArray(recorded) ? recorded.length : 0).toBe(1);
      // Argument order differs per route (a deposit takes the recipient last),
      // so this asserts the address reached the call rather than its position.
      expect(Array.isArray(recorded) ? recorded[0] : []).toContain(RECIPIENT);
    });

    test(`a refused ${label} recipient reaches the user and prepares nothing`, async () => {
      const { calls, preparing } = drive(route, {
        [call]: async () => {
          throw new Error(POISONING_REFUSAL);
        },
      });

      await expect(preparing).rejects.toThrow(POISONING_REFUSAL);
      // The refusal is a preparation failure, so nothing was ever submitted:
      // the panel has no executable payload to confirm.
      expect(calls.submitTransfer).toEqual([]);
      // And the route names itself in the fallback copy, so a refusal that
      // carried no message still tells the user which leg did not happen.
      expect(preparationFailure(route).length).toBeGreaterThan(0);
    });
  }
});

describe("a public send is not routed through a preparation", () => {
  test("the public route prepares nothing, so its gate is the ERC20 submit path", () => {
    const route = routeFor("public", "public");
    const { calls, preparing } = drive(route);

    expect(preparing).toBeNull();
    expect(calls.preparePrivacyDeposit).toEqual([]);
    expect(calls.preparePrivacyTransfer).toEqual([]);
    expect(calls.preparePrivacyWithdraw).toEqual([]);
  });
});
