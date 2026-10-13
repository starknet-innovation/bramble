/**
 * The SDK shadow account module is opt-in per network. A shadow account request
 * on a network without it never reaches an approval card it could only fail
 * after (#443, PR 3) — but it is not refused at once either, because an instant
 * refusal lets any site probe silently whether the user has private services
 * set up. The wallet holds it on its own surface as a notice with one line and
 * a Close control; the site gets the same refusal only once the user closes it.
 * Nothing is signed, prepared, or disclosed. Requests that do not need the
 * module are unaffected.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { toProviderPayload } from "@bramble/wallet-protocol/bridge";
import {
  APPROVAL_TTL_MS,
  createApprovalQueue,
} from "../../../apps/extension/src/background/approvals/approvals";
import { flushHeld, latestApprovalId, waitForPendingApprovals } from "../../support/held";
import {
  buildStrk20Handler,
  makeStrk20Service,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

const MISSING =
  "strk20 services unavailable: no shadow account anonymizer is configured for this network";

const defaults = defaultWalletPreferences();
const mainnet = defaults.strk20Networks?.SN_MAIN;
if (!mainnet) throw new Error("missing bundled Mainnet STRK20 config");
// The bundled config, which ships without the opt-in module.
const withoutAnonymizer = {
  ...defaults,
  activeNetworkId: "SN_SEPOLIA" as const,
  strk20Networks: { ...defaults.strk20Networks, SN_SEPOLIA: mainnet },
};

const shadowAccountInvoke = {
  calls: [{ calldata: [], contract_address: STRK20_RECIPIENT, entry_point: "swap" }],
  collect_policy: { type: "all" },
  dapp_name: "Example",
  nonce: "0x1",
  type: "shadow_account_invoke",
};

const REQUESTS = [
  {
    message: {
      dappName: "Example",
      origin: STRK20_ORIGIN,
      type: "wallet.strk20ShadowAccountCommitment",
    },
    method: "wallet_strk20ShadowAccountCommitment",
  },
  {
    message: {
      actions: [shadowAccountInvoke],
      origin: STRK20_ORIGIN,
      simulate: false,
      type: "wallet.strk20PrepareInvoke",
    },
    method: "wallet_strk20PrepareInvoke",
  },
  {
    message: {
      actions: [shadowAccountInvoke],
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

describe("shadow account requests without an anonymizer", () => {
  // Audit F5: the site gets nothing until the user closes the notice. If the
  // notice expires instead, the site gets what any expired approval gives
  // (113 "request rejected"), not the notice's own 163 refusal.
  for (const request of REQUESTS) {
    test(`${request.method} expires like any approval, never with the notice's refusal`, async () => {
      const clock = { now: 1_700_000_000_000 };
      const handler = buildStrk20Handler({
        approvals: createApprovalQueue({ now: () => clock.now }),
        preferences: withoutAnonymizer,
      });
      let settled: unknown = "unsettled";
      const held = handler(request.message, STRK20_CONTENT_SENDER).then((result) => {
        settled = result;
        return result;
      });
      await waitForPendingApprovals(handler, STRK20_EXTENSION_SENDER);
      await flushHeld();
      expect(settled).toBe("unsettled");

      clock.now += APPROVAL_TTL_MS + 1;
      expect(await pendingCount(handler)).toBe(0);
      const result = await held;
      expect(result).toEqual({ error: "request rejected" });
      expect(JSON.stringify(result)).not.toContain("anonymizer");
      expect(toProviderPayload(result, request.method).error).toMatchObject({ code: 113 });
    });
  }

  for (const request of REQUESTS) {
    for (const close of ["wallet.denyOrigin", "wallet.approveOrigin"] as const) {
      test(`${request.method} is held on a notice and refused only on ${close}`, async () => {
        const shadowAccountCalls = { value: 0 };
        const proveCalls = { value: 0 };
        const handler = buildStrk20Handler({
          preferences: withoutAnonymizer,
          proveCalls,
          shadowAccountCalls,
        });
        let settled: unknown = "unsettled";
        const held = handler(request.message, STRK20_CONTENT_SENDER).then((result) => {
          settled = result;
          return result;
        });

        const pending = await waitForPendingApprovals<{
          readonly id: string;
          readonly kind: string;
          readonly summaries?: readonly string[];
        }>(handler, STRK20_EXTENSION_SENDER);
        expect(pending.map((approval) => approval.kind)).toEqual(["strk20-unavailable"]);
        // The notice carries nothing the site sent and nothing to approve.
        expect(pending[0]?.summaries).toBeUndefined();
        await flushHeld();
        expect(settled).toBe("unsettled");

        const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
        await handler({ id, type: close }, STRK20_EXTENSION_SENDER);
        const result = await held;
        expect(result).toEqual({ error: MISSING });
        expect(await pendingCount(handler)).toBe(0);
        expect(shadowAccountCalls.value).toBe(0);
        expect(proveCalls.value).toBe(0);
        expect(toProviderPayload(result, request.method).error).toEqual({
          code: 163,
          data: MISSING,
          message: "The wallet request failed",
        });
      });
    }

    test(`${request.method} reaches its approval once one is configured`, async () => {
      const handler = buildStrk20Handler();
      void handler(request.message, STRK20_CONTENT_SENDER);

      expect(await waitForPendingApprovals(handler, STRK20_EXTENSION_SENDER)).toHaveLength(1);
    });
  }

  test("a batch without a shadow account invoke does not need one", async () => {
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

  // Owner rule (F5 leftover): with an anonymizer configured, a shadow invoke
  // quotes its fee before the card. A fast quote failure would tell the site
  // an anonymizer is configured, so it is held on the same notice. Configured
  // with a failing quote and not configured at all look the same to the site:
  // nothing until the user acts, and 113 on expiry.
  const QUOTE_FAILED = "strk20 services unavailable: relay quote failed";
  const failingQuote = {
    ...makeStrk20Service({}),
    async quoteActions(): Promise<never> {
      throw new WalletError(QUOTE_FAILED);
    },
  };
  const invokeRequest = REQUESTS[2];
  for (const setup of ["configured, quote fails", "not configured"] as const) {
    const options =
      setup === "not configured" ? { preferences: withoutAnonymizer } : { strk20: failingQuote };
    test(`${setup}: the site gets nothing until the user acts, and 113 on expiry`, async () => {
      const clock = { now: 1_700_000_000_000 };
      const handler = buildStrk20Handler({
        approvals: createApprovalQueue({ now: () => clock.now }),
        ...options,
      });
      let settled: unknown = "unsettled";
      const held = handler(invokeRequest.message, STRK20_CONTENT_SENDER).then((result) => {
        settled = result;
        return result;
      });
      const pending = await waitForPendingApprovals<{
        readonly id: string;
        readonly kind: string;
        readonly notice?: string;
        readonly summaries?: readonly string[];
      }>(handler, STRK20_EXTENSION_SENDER);
      expect(pending.map((approval) => approval.kind)).toEqual(["strk20-unavailable"]);
      expect(pending[0]?.notice).toBe(setup === "not configured" ? undefined : "request-failed");
      expect(pending[0]?.summaries).toBeUndefined();
      await flushHeld();
      expect(settled).toBe("unsettled");
      clock.now += APPROVAL_TTL_MS + 1;
      expect(await pendingCount(handler)).toBe(0);
      const result = await held;
      expect(result).toEqual({ error: "request rejected" });
      expect(toProviderPayload(result, invokeRequest.method).error).toMatchObject({ code: 113 });
    });
  }

  test("configured, quote fails: Close delivers the quote's own refusal", async () => {
    const handler = buildStrk20Handler({ strk20: failingQuote });
    const held = handler(invokeRequest.message, STRK20_CONTENT_SENDER);
    const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
    await handler({ id, type: "wallet.denyOrigin" }, STRK20_EXTENSION_SENDER);
    expect(await held).toEqual({ error: QUOTE_FAILED });
  });
});
