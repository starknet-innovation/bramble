/**
 * Spec item 15: a connection grant is bound to the account the approval card
 * named. The card echoes that account with the decision; the background refuses
 * the approval if the vault's active account has moved since, and pins the
 * account id into the grant so the write cannot follow a later switch either.
 * A reconnect prompt for a site that already holds a grant says so, so the
 * card can state the grant delta instead of implying a first share.
 */
import { describe, expect, test } from "bun:test";
import type { OriginGrantInput } from "@bramble/vault/service";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { promptReconnectForStaleGrant } from "../../../apps/extension/src/background/approvals/reconnect-prompt";
import { readApprovalIdInput } from "../../../apps/extension/src/background/routing/approval-decision-inputs";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  createWallet,
  extensionSender,
  secondAccount,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const ORIGIN = "https://dapp.example";
const ACCOUNT_CHANGED = { error: "the account changed since this request was reviewed" };

const connectHarness = (activeAccountId: () => string) => {
  const captured: OriginGrantInput[] = [];
  const approvals = createApprovalQueue();
  const session = createUnlockSession();
  const handler = createMessageHandler(
    createWallet({
      accounts: [account, secondAccount],
      activeAccountId,
      captureGrant: (input) => captured.push(input),
    }),
    testExtension,
    { approvals, session },
  );
  return { approvals, captured, handler, session };
};

describe("connection approvals bind to the reviewed account", () => {
  test("grants the account the card named when it is still the active one", async () => {
    const { approvals, captured, handler } = connectHarness(() => account.id);
    const pending = approvals.request(ORIGIN);
    await handler({ type: "wallet.unlock", vaultPassphrase }, extensionSender);

    await expect(
      handler(
        { id: pending.id, reviewedAccountId: account.id, type: "wallet.approveOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual({ accounts: [account], ok: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ accountId: account.id, origin: ORIGIN });
  });

  test("refuses the approval when the active account moved after the card was painted", async () => {
    // The card was painted while `account` was active; the user then switched
    // to `secondAccount` in the panel before clicking Approve.
    const { approvals, captured, handler } = connectHarness(() => secondAccount.id);
    const pending = approvals.request(ORIGIN);
    await handler({ type: "wallet.unlock", vaultPassphrase }, extensionSender);

    await expect(
      handler(
        { id: pending.id, reviewedAccountId: account.id, type: "wallet.approveOrigin" },
        extensionSender,
      ),
    ).resolves.toEqual(ACCOUNT_CHANGED);
    expect(captured).toHaveLength(0);
    // The refusal settles the claim: the dapp gets the answer, nothing is shared.
    await expect(handler({ type: "wallet.pendingApprovals" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });

  test("pins the active account into the grant even when no echo travelled", async () => {
    const { approvals, captured, handler } = connectHarness(() => secondAccount.id);
    const pending = approvals.request(ORIGIN);
    await handler({ type: "wallet.unlock", vaultPassphrase }, extensionSender);

    await expect(
      handler({ id: pending.id, type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toMatchObject({ ok: true });
    expect(captured[0]).toMatchObject({ accountId: secondAccount.id });
  });

  test("a reconnect prompt records that the site already holds a grant", () => {
    const approvals = createApprovalQueue();
    promptReconnectForStaleGrant(approvals, [account], ORIGIN);
    expect(approvals.list()).toMatchObject([
      { existingGrant: true, kind: "connect", origin: ORIGIN },
    ]);

    const fresh = createApprovalQueue();
    fresh.request(ORIGIN);
    expect(fresh.list()[0]).not.toHaveProperty("existingGrant");
  });
});

describe("approval decision reader", () => {
  const id = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";

  test("admits a canonical account id echo and nothing else in its place", () => {
    expect(
      readApprovalIdInput({ id, reviewedAccountId: account.id, type: "wallet.approveOrigin" }),
    ).toEqual({ id, reviewedAccountId: account.id });
    expect(readApprovalIdInput({ id, type: "wallet.approveOrigin" })).toEqual({ id });
    for (const bad of ["", "not-an-account", 42, null, account.id.toUpperCase()]) {
      expect(
        readApprovalIdInput({ id, reviewedAccountId: bad, type: "wallet.approveOrigin" }),
        String(bad),
      ).toBeNull();
    }
  });
});
