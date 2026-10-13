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
 * Two enforcement points, both pinned here. At request time a poisoned payment
 * is queued with an `address-poisoning` flag, whose card offers Deny only,
 * rather than refused on arrival: an instant refusal told the site which
 * addresses the user has saved or paid (Sherlock 140). The post-consent gate in
 * ./strk20-approval-execution, the last thing that runs before a proof is
 * produced or a transaction is broadcast, refuses it even if it is approved,
 * and also catches a contact saved while the prompt is on screen.
 *
 * Flat invokes have no selector, so their calldata is conservatively scanned;
 * shadowAccount invokes carry full calls and use the exact shared decoder.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20Service } from "@bramble/privacy/service";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { flushHeld, waitForPendingApprovals } from "../support/held";
import {
  CLEAN_RECIPIENT,
  POISONED_RECIPIENT,
  poolPreferences,
  shadowAccountPoolPreferences,
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

type ListedApproval = {
  readonly flags?: readonly { readonly code: string; readonly message: string }[];
  readonly id: string;
};

// Queued with the poisoning flag instead of refused on arrival, so the answer
// reveals nothing about the address book until the user acts; even a forced
// approve is refused at the post-consent gate, before anything is proved.
const expectFlaggedAndRefusedOnApprove = async (
  handler: Strk20Handler,
  message: Readonly<Record<string, unknown>>,
  proveCalls: { value: number },
): Promise<void> => {
  const response = handler(message, STRK20_CONTENT_SENDER);
  await flushHeld();
  const listed = await waitForPendingApprovals<ListedApproval>(handler, STRK20_EXTENSION_SENDER);
  const approval = listed.at(-1);
  expect(approval?.flags).toEqual([
    { code: "address-poisoning", message: expect.stringContaining("closely mimics") },
  ]);
  await handler({ id: approval?.id, type: "wallet.approveOrigin" }, STRK20_EXTENSION_SENDER);
  await expect(response).resolves.toEqual({ error: expect.stringContaining("closely mimics") });
  expect(proveCalls.value).toBe(0);
};

// A `shadow_account_invoke` carries full spec INVOKE_CALLs — contract, entry point,
// and felt calldata — which is exactly the shape `wallet.addInvokeTransaction`
// accepts and the shared verifier decodes. The recipient below therefore sits in
// the same calldata slot the public dapp route refuses on.
const shadowAccountInvokeMessage = (recipient: string) => ({
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
      type: "shadow_account_invoke",
    },
  ],
  origin: STRK20_ORIGIN,
  type: "wallet.strk20InvokeTransaction",
});

const shadowAccountPrepareMessage = (recipient: string) => ({
  ...shadowAccountInvokeMessage(recipient),
  simulate: false,
  type: "wallet.strk20PrepareInvoke",
});

describe("dapp-facing STRK20 invoke", () => {
  for (const kind of routes) {
    test(`flags a poisoned ${kind} and refuses it even when approved`, async () => {
      const proveCalls = { value: 0 };
      const handler = buildStrk20Handler({ preferences: poolPreferences(), proveCalls });

      await expectFlaggedAndRefusedOnApprove(
        handler,
        invokeMessage(kind, POISONED_RECIPIENT),
        proveCalls,
      );
    });

    test(`flags a poisoned ${kind} preparation and refuses it even when approved`, async () => {
      const proveCalls = { value: 0 };
      const handler = buildStrk20Handler({ preferences: poolPreferences(), proveCalls });

      await expectFlaggedAndRefusedOnApprove(
        handler,
        prepareMessage(kind, POISONED_RECIPIENT),
        proveCalls,
      );
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

  test("flags a poisoned shadow-account invoke and refuses it even when approved", async () => {
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ preferences: shadowAccountPoolPreferences(), proveCalls });

    await expectFlaggedAndRefusedOnApprove(
      handler,
      shadowAccountInvokeMessage(POISONED_RECIPIENT),
      proveCalls,
    );
  });

  test("flags a poisoned shadow-account invoke preparation and refuses it even when approved", async () => {
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ preferences: shadowAccountPoolPreferences(), proveCalls });

    await expectFlaggedAndRefusedOnApprove(
      handler,
      shadowAccountPrepareMessage(POISONED_RECIPIENT),
      proveCalls,
    );
  });

  test("answers a denied poisoned request exactly as a denied clean one (Sherlock 140)", async () => {
    const denied = async (recipient: string): Promise<unknown> => {
      const handler = buildStrk20Handler({ preferences: poolPreferences() });
      const response = handler(invokeMessage("transfer", recipient), STRK20_CONTENT_SENDER);
      await flushHeld();
      const listed = await waitForPendingApprovals<ListedApproval>(
        handler,
        STRK20_EXTENSION_SENDER,
      );
      await handler({ id: listed.at(-1)?.id, type: "wallet.denyOrigin" }, STRK20_EXTENSION_SENDER);
      return response;
    };
    expect(await denied(POISONED_RECIPIENT)).toEqual(await denied(CLEAN_RECIPIENT));
  });

  test("still submits a shadow-account invoke paying a recipient the wallet does not recognize", async () => {
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({
      preferences: shadowAccountPoolPreferences(),
      proveCalls,
    });

    await expect(
      approveHeldStrk20(handler, shadowAccountInvokeMessage(CLEAN_RECIPIENT), "strk20-invoke"),
    ).resolves.toMatchObject({ ok: true });
    expect(proveCalls.value).toBe(1);
  });

  test("flags a poisoned felt hidden in selector-free flat invoke calldata", async () => {
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ preferences: poolPreferences(), proveCalls });

    await expectFlaggedAndRefusedOnApprove(
      handler,
      {
        actions: [
          {
            calldata: ["0x1", POISONED_RECIPIENT, "0x0"],
            contract: STRK20_TOKEN,
            type: "invoke",
          },
        ],
        origin: STRK20_ORIGIN,
        type: "wallet.strk20InvokeTransaction",
      },
      proveCalls,
    );
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

  test("refuses to submit an approved shadow-account invoke whose recipient became a lookalike", async () => {
    const clean: WalletPreferences = { ...shadowAccountPoolPreferences(), addressBook: [] };
    let current = clean;
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ preferencesRead: () => current, proveCalls });

    await expect(
      approveHeldStrk20(
        handler,
        shadowAccountInvokeMessage(POISONED_RECIPIENT),
        "strk20-invoke",
        () => {
          current = shadowAccountPoolPreferences();
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
