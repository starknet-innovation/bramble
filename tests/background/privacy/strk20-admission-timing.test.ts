/**
 * Audit N2 and N3. A configured shadow invoke reads the vault and quotes its
 * fee before its card queues; a request on a network without the anonymizer is
 * held on a notice at once. With admission counted against the queue alone,
 * an over-cap burst was refused the moment the notices queued when nothing was
 * configured, but only once the quotes finished when something was: the reply
 * time told the site. And each card's expiry ran from when it queued, so it too
 * carried the quote time.
 *
 * Every STRK20 dapp request now reserves its queue slot, the admission limit
 * and its deadline on arrival, before any configuration-dependent work; the
 * card or notice that follows takes the slot over and keeps the deadline.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import { toProviderPayload } from "@bramble/wallet-protocol/bridge";
import {
  APPROVAL_TTL_MS,
  createApprovalQueue,
  MAX_PENDING_APPROVALS_PER_ORIGIN,
} from "../../../apps/extension/src/background/approvals/approvals";
import { flushHeld } from "../../support/held";
import {
  buildStrk20Handler,
  makeStrk20Service,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TEST_ANONYMIZER,
} from "../../support/strk20-background";

const defaults = defaultWalletPreferences();
const mainnet = defaults.strk20Networks?.SN_MAIN;
if (!mainnet) throw new Error("missing bundled Mainnet STRK20 config");
const configured: WalletPreferences = {
  ...defaults,
  activeNetworkId: "SN_SEPOLIA",
  strk20Networks: {
    ...defaults.strk20Networks,
    SN_SEPOLIA: { ...mainnet, shadowAccountAnonymizerAddress: STRK20_TEST_ANONYMIZER },
  },
};
const notConfigured: WalletPreferences = {
  ...defaults,
  activeNetworkId: "SN_SEPOLIA",
  strk20Networks: { ...defaults.strk20Networks, SN_SEPOLIA: mainnet },
};

const shadowInvoke = (nonce: number) => ({
  actions: [
    {
      calls: [{ calldata: [], contract_address: STRK20_RECIPIENT, entry_point: "swap" }],
      collect_policy: { type: "all" },
      dapp_name: "Example",
      nonce: `0x${(nonce + 1).toString(16)}`,
      type: "shadow_account_invoke",
    },
  ],
  origin: STRK20_ORIGIN,
  type: "wallet.strk20InvokeTransaction",
});

// A quote that waits until the test opens it, so the configured path's
// pre-card work is still running for as long as the test needs.
const gatedService = (outcome: "quote" | "fail" = "quote") => {
  const base = makeStrk20Service({});
  const gates: (() => void)[] = [];
  let quotes = 0;
  return {
    open: () => {
      for (const open of gates.splice(0)) open();
    },
    quotes: () => quotes,
    service: {
      ...base,
      async quoteActions(...args: Parameters<typeof base.quoteActions>) {
        quotes += 1;
        await new Promise<void>((resolve) => gates.push(resolve));
        if (outcome === "fail") throw new Error("relay quote failed");
        return base.quoteActions(...args);
      },
    },
  };
};

const pendingKinds = async (
  handler: ReturnType<typeof buildStrk20Handler>,
): Promise<readonly string[]> => {
  const response = (await handler(
    { type: "wallet.pendingApprovals" },
    STRK20_EXTENSION_SENDER,
  )) as {
    readonly pending: readonly { readonly kind: string }[];
  };
  return response.pending.map((approval) => approval.kind);
};

const settle = async (): Promise<void> => {
  for (let flush = 0; flush < 10; flush += 1) await flushHeld();
};

describe("an over-cap burst is refused on arrival, configured or not (N2)", () => {
  for (const setup of ["configured", "not configured"] as const) {
    test(`${setup}: the request past the cap is refused before any preference read`, async () => {
      const gated = gatedService();
      let preferenceReads = 0;
      const handler = buildStrk20Handler({
        preferencesRead: () => {
          preferenceReads += 1;
          return setup === "configured" ? configured : notConfigured;
        },
        strk20: gated.service,
      });

      const first = Array.from({ length: MAX_PENDING_APPROVALS_PER_ORIGIN }, (_, index) => {
        const state = { settled: false };
        void handler(shadowInvoke(index), STRK20_CONTENT_SENDER).then(() => {
          state.settled = true;
        });
        return state;
      });
      await settle();
      // The admitted five are held: on a quote still running, or on a notice.
      expect(first.every((state) => !state.settled)).toBe(true);

      const readsBefore = preferenceReads;
      let overCap: unknown = "unsettled";
      void handler(shadowInvoke(99), STRK20_CONTENT_SENDER).then((result) => {
        overCap = result;
      });
      await settle();
      // Refused while the configured quotes are all still waiting, and without
      // reading anything the answer could depend on.
      expect(overCap).not.toBe("unsettled");
      expect(toProviderPayload(overCap as never, "wallet_strk20InvokeTransaction").error).toEqual(
        expect.objectContaining({ code: 163 }),
      );
      expect(preferenceReads).toBe(readsBefore);
      expect(gated.quotes()).toBe(setup === "configured" ? MAX_PENDING_APPROVALS_PER_ORIGIN : 0);
      gated.open();
    });
  }

  test("the refusal is the same answer both ways", async () => {
    const answers: unknown[] = [];
    for (const preferences of [configured, notConfigured]) {
      const gated = gatedService();
      const handler = buildStrk20Handler({ preferences, strk20: gated.service });
      for (let index = 0; index < MAX_PENDING_APPROVALS_PER_ORIGIN; index += 1) {
        void handler(shadowInvoke(index), STRK20_CONTENT_SENDER);
      }
      await settle();
      answers.push(await handler(shadowInvoke(99), STRK20_CONTENT_SENDER));
      gated.open();
    }
    expect(answers[0]).toEqual(answers[1]);
  });
});

describe("a card or notice expires from the request's arrival (N3)", () => {
  for (const outcome of ["quote", "fail"] as const) {
    test(`configured, ${outcome === "quote" ? "card" : "request-failed notice"} after a slow quote`, async () => {
      const clock = { now: 1_700_000_000_000 };
      const gated = gatedService(outcome);
      const handler = buildStrk20Handler({
        approvals: createApprovalQueue({ now: () => clock.now }),
        preferences: configured,
        strk20: gated.service,
      });
      let settled: unknown = "unsettled";
      void handler(shadowInvoke(0), STRK20_CONTENT_SENDER).then((result) => {
        settled = result;
      });
      await settle();
      expect(gated.quotes()).toBe(1);

      // The quote takes all but the last millisecond of the TTL.
      clock.now += APPROVAL_TTL_MS - 1;
      gated.open();
      await settle();
      expect(await pendingKinds(handler)).toEqual([
        outcome === "quote" ? "strk20-invoke" : "strk20-unavailable",
      ]);
      expect(settled).toBe("unsettled");

      clock.now += 1;
      expect(await pendingKinds(handler)).toEqual([]);
      await settle();
      expect(settled).toEqual({ error: "request rejected" });
    });
  }

  test("not configured, the notice expires on the same deadline", async () => {
    const clock = { now: 1_700_000_000_000 };
    const handler = buildStrk20Handler({
      approvals: createApprovalQueue({ now: () => clock.now }),
      preferences: notConfigured,
    });
    let settled: unknown = "unsettled";
    void handler(shadowInvoke(0), STRK20_CONTENT_SENDER).then((result) => {
      settled = result;
    });
    await settle();
    clock.now += APPROVAL_TTL_MS - 1;
    expect(await pendingKinds(handler)).toEqual(["strk20-unavailable"]);
    clock.now += 1;
    expect(await pendingKinds(handler)).toEqual([]);
    await settle();
    expect(settled).toEqual({ error: "request rejected" });
  });
});

describe("an arrival time never extends a deadline", () => {
  test("a future arrivedAt is clamped to the enqueue time", () => {
    const clock = { now: 1_700_000_000_000 };
    const queue = createApprovalQueue({ now: () => clock.now });
    queue.requestStrk20Unavailable({
      arrivedAt: clock.now + APPROVAL_TTL_MS,
      origin: STRK20_ORIGIN,
      refusal: "request rejected",
    });
    clock.now += APPROVAL_TTL_MS;
    expect(queue.list()).toEqual([]);
  });

  test("a reservation reports when it was admitted", () => {
    const clock = { now: 1_700_000_000_000 };
    const queue = createApprovalQueue({ now: () => clock.now });
    const reservation = queue.reserve(STRK20_ORIGIN);
    expect(reservation.arrivedAt).toBe(clock.now);
    reservation.release();
  });
});
