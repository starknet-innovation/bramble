/**
 * Audit #163 at the STRK20 proof boundary: both execute-time recipient
 * re-checks (the wallet's own pool routes and the dapp-facing invoke) must
 * judge against the LIVE trusted set, paid recipients included, not only the
 * address book. A payment recorded between review and proof (another send that
 * landed meanwhile) makes a pending lookalike recipient refusable, exactly as a
 * contact saved during review already does.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20Service } from "@bramble/privacy/service";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { poolPreferences, poolToken } from "../support/poisoned-recipients";
import {
  approveHeldStrk20,
  buildStrk20Handler,
  executeStrk20Preparation,
  makeStrk20Service,
  prepareStrk20Deposit,
  STRK20_ORIGIN,
  STRK20_TOKEN,
} from "../support/strk20-background";

const PAID = "0x049d3aa7890abcdef1234567890abcdef1234567890abcdef1234567890a9f1e";
const PAID_TWIN = "0x049d3ff111111111111111111111111111111111111111111111111111119f1e";

// A pool service whose proof step first records a wallet-origin payment to
// PAID, then runs the execute-time gate: only a gate that reads the activity
// log at that moment can see the new trust input.
const payingMidFlight = () => {
  const activity = memoryActivityLog(() => 10);
  const proveCalls = { value: 0 };
  const base = makeStrk20Service({ balance: "0xde0b6b3a7640000" });
  const strk20: Strk20Service = {
    ...base,
    async submitActions({ beforeProof }) {
      await activity.record({
        accountId: "SN_SEPOLIA:0xabcabcdef",
        counterparty: PAID,
        hash: "0x77",
        kind: "transfer",
        networkId: "SN_SEPOLIA",
        origin: "wallet",
        summary: "Sent 1 STRK",
      });
      await beforeProof?.();
      proveCalls.value += 1;
      return { transactionHash: "0x123" };
    },
  };
  return { activity, proveCalls, strk20 };
};

describe("STRK20 execute-time re-checks read paid recipients (#163)", () => {
  test("wallet pool route: a payment recorded before proof refuses the pending lookalike", async () => {
    const preferences: WalletPreferences = { ...poolPreferences(), addressBook: [] };
    const { activity, proveCalls, strk20 } = payingMidFlight();
    const handler = buildStrk20Handler({ activity, preferences, strk20 });
    const prepared = (await prepareStrk20Deposit(handler, {
      amount: "0.5",
      recipient: PAID_TWIN,
      tokenId: poolToken(preferences).id,
      type: "wallet.strk20PrepareTransfer",
    })) as { readonly strk20Preparation?: { readonly id: string } };
    const preparationId = prepared.strk20Preparation?.id;
    if (!preparationId) throw new Error(`transfer did not prepare: ${JSON.stringify(prepared)}`);

    await expect(executeStrk20Preparation(handler, preparationId)).resolves.toEqual({
      error: expect.stringContaining("closely mimics"),
    });
    expect(proveCalls.value).toBe(0);
  });

  test("dapp invoke: a payment recorded before proof refuses the approved lookalike", async () => {
    const preferences: WalletPreferences = { ...poolPreferences(), addressBook: [] };
    const { activity, proveCalls, strk20 } = payingMidFlight();
    const handler = buildStrk20Handler({ activity, preferences, strk20 });

    await expect(
      approveHeldStrk20(
        handler,
        {
          actions: [{ amount: "0x1", recipient: PAID_TWIN, token: STRK20_TOKEN, type: "withdraw" }],
          origin: STRK20_ORIGIN,
          type: "wallet.strk20InvokeTransaction",
        },
        "strk20-invoke",
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(proveCalls.value).toBe(0);
  });
});
