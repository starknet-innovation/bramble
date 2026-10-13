/**
 * The SDK sub-account module is opt-in per network. A sub-account request on a
 * network without it is refused before its approval is queued (#443, PR 3),
 * instead of reaching the card and failing after the user approves. Requests
 * that do not need the module are unaffected.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { toProviderPayload } from "@bramble/wallet-protocol/bridge";
import { flushHeld, waitForPendingApprovals } from "../../support/held";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

const MISSING =
  "strk20 services unavailable: no sub-account anonymizer is configured for this network";

const defaults = defaultWalletPreferences();
const mainnet = defaults.strk20Networks?.SN_MAIN;
if (!mainnet) throw new Error("missing bundled Mainnet STRK20 config");
// The bundled config, which ships without the opt-in module.
const withoutAnonymizer = {
  ...defaults,
  activeNetworkId: "SN_SEPOLIA" as const,
  strk20Networks: { ...defaults.strk20Networks, SN_SEPOLIA: mainnet },
};

const subaccountInvoke = {
  calls: [{ calldata: [], contract_address: STRK20_RECIPIENT, entry_point: "swap" }],
  collect_policy: { type: "all" },
  dapp_name: "Example",
  nonce: "0x1",
  type: "subaccount_invoke",
};

const REQUESTS = [
  {
    message: {
      dappName: "Example",
      origin: STRK20_ORIGIN,
      type: "wallet.strk20SubaccountCommitment",
    },
    method: "wallet_strk20SubaccountCommitment",
  },
  {
    message: {
      actions: [subaccountInvoke],
      origin: STRK20_ORIGIN,
      simulate: false,
      type: "wallet.strk20PrepareInvoke",
    },
    method: "wallet_strk20PrepareInvoke",
  },
  {
    message: {
      actions: [subaccountInvoke],
      origin: STRK20_ORIGIN,
      type: "wallet.strk20InvokeTransaction",
    },
    method: "wallet_strk20InvokeTransaction",
  },
] as const;

const pendingCount = async (handler: ReturnType<typeof buildStrk20Handler>): Promise<number> => {
  await flushHeld();
  const response = (await handler(
    { type: "wallet.pendingApprovals" },
    STRK20_EXTENSION_SENDER,
  )) as {
    readonly pending: readonly unknown[];
  };
  return response.pending.length;
};

describe("sub-account requests without an anonymizer", () => {
  for (const request of REQUESTS) {
    test(`${request.method} is refused before approval`, async () => {
      const subaccountCalls = { value: 0 };
      const handler = buildStrk20Handler({ preferences: withoutAnonymizer, subaccountCalls });
      const result = await handler(request.message, STRK20_CONTENT_SENDER);

      expect(result).toEqual({ error: MISSING });
      expect(await pendingCount(handler)).toBe(0);
      expect(subaccountCalls.value).toBe(0);
      expect(toProviderPayload(result, request.method).error).toEqual({
        code: 163,
        data: MISSING,
        message: "The wallet request failed",
      });
    });

    test(`${request.method} reaches its approval once one is configured`, async () => {
      const handler = buildStrk20Handler();
      void handler(request.message, STRK20_CONTENT_SENDER);

      expect(await waitForPendingApprovals(handler, STRK20_EXTENSION_SENDER)).toHaveLength(1);
    });
  }

  test("a batch without a sub-account invoke does not need one", async () => {
    const handler = buildStrk20Handler({ preferences: withoutAnonymizer });
    void handler(
      {
        actions: [
          { amount: "0x0a", recipient: STRK20_RECIPIENT, token: STRK20_TOKEN, type: "withdraw" },
        ],
        origin: STRK20_ORIGIN,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      STRK20_CONTENT_SENDER,
    );

    expect(await waitForPendingApprovals(handler, STRK20_EXTENSION_SENDER)).toHaveLength(1);
  });
});
