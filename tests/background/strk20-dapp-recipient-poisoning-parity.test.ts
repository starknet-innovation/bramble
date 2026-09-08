/**
 * MCW-V09-109, dapp-facing STRK20 line. Sibling of
 * ./send-recipient-poisoning-parity.test.ts; split only to keep both files under
 * the size limit.
 *
 * `wallet.strk20InvokeTransaction` and `wallet.strk20PrepareInvoke` are in
 * DAPP_MESSAGES and carry a recipient on their withdraw and transfer actions.
 * The wallet's own routes to the same pool refused a poisoned recipient; these
 * two did not — same product line, same recipient semantics, opposite policy,
 * and the unenforced side was the attacker-controlled one.
 *
 * Two enforcement points, both pinned here: the request-time gate, so no confirm
 * button is ever raised for a poisoned payment, and the post-consent gate in
 * ./strk20-approval-execution, which is the last thing that runs before a proof
 * is produced or a transaction is broadcast. The second is not redundant — the
 * contact a recipient mimics can be saved while the prompt is on screen.
 *
 * Flat invokes have no selector, so their calldata is conservatively scanned;
 * subaccount invokes carry full calls and use the exact shared decoder.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20Service } from "@bramble/privacy/service";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { flushHeld, waitForPendingApprovals } from "../support/held";
import {
  CLEAN_RECIPIENT,
  POISONED_RECIPIENT,
  poolPreferences,
  subaccountPoolPreferences,
} from "../support/poisoned-recipients";
import {
  approveHeldStrk20,
  buildStrk20Handler,
  makeStrk20Service,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_TOKEN,
  type Strk20Handler,
} from "../support/strk20-background";

const action = (type: "transfer" | "withdraw", recipient: string) => ({
  amount: "0x1",
  recipient,
  token: STRK20_TOKEN,
  type,
});

const invokeMessage = (type: "transfer" | "withdraw", recipient: string) => ({
  actions: [action(type, recipient)],
  origin: STRK20_ORIGIN,
  type: "wallet.strk20InvokeTransaction",
});

const prepareMessage = (type: "transfer" | "withdraw", recipient: string) => ({
  actions: [action(type, recipient)],
  origin: STRK20_ORIGIN,
  simulate: false,
  type: "wallet.strk20PrepareInvoke",
});

const routes = ["transfer", "withdraw"] as const;

const expectRefusedWithoutPrompt = async (
  handler: Strk20Handler,
  message: Readonly<Record<string, unknown>>,
): Promise<void> => {
  const response = handler(message, STRK20_CONTENT_SENDER);
  await flushHeld();
  await expect(
    handler({ type: "wallet.pendingApprovals" }, STRK20_EXTENSION_SENDER),
  ).resolves.toMatchObject({ pending: [] });
  await expect(response).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
};

// A `subaccount_invoke` carries full spec INVOKE_CALLs — contract, entry point,
// and felt calldata — which is exactly the shape `wallet.addInvokeTransaction`
// accepts and the shared verifier decodes. The recipient below therefore sits in
// the same calldata slot the public dapp route refuses on.
const subaccountInvokeMessage = (recipient: string) => ({
  actions: [
    {
      calls: [
        {
          calldata: [recipient, "0xde0b6b3a7640000", "0x0"],
          contract_address: STRK20_TOKEN,
          entry_point: "transfer",
        },
      ],
      collect_policy: { type: "all" },
      dapp_name: "Example",
      nonce: "0x7",
      type: "subaccount_invoke",
    },
  ],
  origin: STRK20_ORIGIN,
  type: "wallet.strk20InvokeTransaction",
});

const subaccountPrepareMessage = (recipient: string) => ({
  ...subaccountInvokeMessage(recipient),
  simulate: false,
  type: "wallet.strk20PrepareInvoke",
});

describe("dapp-facing STRK20 invoke", () => {
  for (const kind of routes) {
    test(`refuses a poisoned ${kind} instead of queueing a prompt to confirm`, async () => {
      const handler = buildStrk20Handler({ preferences: poolPreferences() });

      await expectRefusedWithoutPrompt(handler, invokeMessage(kind, POISONED_RECIPIENT));
    });

    test(`refuses a poisoned ${kind} preparation`, async () => {
      const handler = buildStrk20Handler({ preferences: poolPreferences() });

      await expectRefusedWithoutPrompt(handler, prepareMessage(kind, POISONED_RECIPIENT));
    });

    test(`still submits a ${kind} to a recipient the wallet does not recognize`, async () => {
      const proveCalls = { value: 0 };
      const handler = buildStrk20Handler({ preferences: poolPreferences(), proveCalls });

      await expect(
        approveHeldStrk20(handler, invokeMessage(kind, CLEAN_RECIPIENT), "strk20-invoke"),
      ).resolves.toMatchObject({ ok: true });
      expect(proveCalls.value).toBe(1);
    });
  }

  test("refuses a poisoned sub-account invoke instead of queueing a prompt to confirm", async () => {
    const handler = buildStrk20Handler({ preferences: subaccountPoolPreferences() });

    await expectRefusedWithoutPrompt(handler, subaccountInvokeMessage(POISONED_RECIPIENT));
  });

  test("refuses a poisoned sub-account invoke preparation", async () => {
    const handler = buildStrk20Handler({ preferences: subaccountPoolPreferences() });

    await expectRefusedWithoutPrompt(handler, subaccountPrepareMessage(POISONED_RECIPIENT));
  });

  test("still submits a sub-account invoke paying a recipient the wallet does not recognize", async () => {
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({
      preferences: subaccountPoolPreferences(),
      proveCalls,
    });

    await expect(
      approveHeldStrk20(handler, subaccountInvokeMessage(CLEAN_RECIPIENT), "strk20-invoke"),
    ).resolves.toMatchObject({ ok: true });
    expect(proveCalls.value).toBe(1);
  });

  test("refuses a poisoned felt hidden in selector-free flat invoke calldata", async () => {
    const handler = buildStrk20Handler({ preferences: poolPreferences() });

    await expectRefusedWithoutPrompt(handler, {
      actions: [
        {
          calldata: ["0x1", POISONED_RECIPIENT, "0x0"],
          contract: STRK20_TOKEN,
          type: "invoke",
        },
      ],
      origin: STRK20_ORIGIN,
      type: "wallet.strk20InvokeTransaction",
    });
  });
});

describe("post-consent enforcement", () => {
  // The request is clean when the prompt goes up and poisoned by the time the
  // user presses approve. Only a gate at the execution point can catch that.
  const withContactSavedDuringReview = (): {
    readonly read: () => WalletPreferences;
    readonly save: () => void;
  } => {
    const clean: WalletPreferences = { ...poolPreferences(), addressBook: [] };
    let current = clean;
    return {
      read: () => current,
      save: () => {
        current = poolPreferences();
      },
    };
  };

  test("refuses to submit an approved private transfer whose recipient became a lookalike", async () => {
    const preferences = withContactSavedDuringReview();
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ preferencesRead: preferences.read, proveCalls });

    await expect(
      approveHeldStrk20(
        handler,
        invokeMessage("withdraw", POISONED_RECIPIENT),
        "strk20-invoke",
        preferences.save,
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    // Nothing was proved: the refusal happens before the pool is touched.
    expect(proveCalls.value).toBe(0);
  });

  test("re-reads recipient policy at the proof boundary, not only when execution starts", async () => {
    let current: WalletPreferences = { ...poolPreferences(), addressBook: [] };
    const proveCalls = { value: 0 };
    const base = makeStrk20Service();
    const strk20: Strk20Service = {
      ...base,
      async submitActions({ beforeProof }) {
        current = poolPreferences();
        await beforeProof?.();
        proveCalls.value += 1;
        return { transactionHash: "0x123" };
      },
    };
    const handler = buildStrk20Handler({
      preferencesRead: () => current,
      proveCalls,
      strk20,
    });

    await expect(
      approveHeldStrk20(handler, invokeMessage("withdraw", POISONED_RECIPIENT), "strk20-invoke"),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(proveCalls.value).toBe(0);
  });

  test("refuses to submit an approved sub-account invoke whose recipient became a lookalike", async () => {
    const clean: WalletPreferences = { ...subaccountPoolPreferences(), addressBook: [] };
    let current = clean;
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ preferencesRead: () => current, proveCalls });

    await expect(
      approveHeldStrk20(
        handler,
        subaccountInvokeMessage(POISONED_RECIPIENT),
        "strk20-invoke",
        () => {
          current = subaccountPoolPreferences();
        },
      ),
    ).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(proveCalls.value).toBe(0);
  });

  test("refuses to produce a submittable proof for one", async () => {
    const preferences = withContactSavedDuringReview();
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ preferencesRead: preferences.read, proveCalls });

    const held = handler(prepareMessage("withdraw", POISONED_RECIPIENT), STRK20_CONTENT_SENDER);
    await flushHeld();
    const listed = await waitForPendingApprovals<{ readonly id: string }>(
      handler,
      STRK20_EXTENSION_SENDER,
    );
    const queued = listed.at(-1);
    if (!queued) {
      throw new Error("no approval was queued for the clean request");
    }
    preferences.save();
    await handler({ id: queued.id, type: "wallet.approveOrigin" }, STRK20_EXTENSION_SENDER);

    await expect(held).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
    expect(proveCalls.value).toBe(0);
  });
});
