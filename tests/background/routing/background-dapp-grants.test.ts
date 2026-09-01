/**
 * Dapp connect and grant prompting through the background message handler.
 *
 * Split from ./background-messages.test.ts by subject: these cover which
 * origin-account grants prompt, stay silent, or expire, while the file next door
 * covers handler dispatch and session lifecycle.
 */

import { describe, expect, test } from "bun:test";
import type { OriginGrantInput } from "@mc-wallet/vault/service";
import { createApprovalQueue } from "../../../apps/extension/src/background/approvals/approvals";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  secondAccount,
  extensionSender as sender,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../../support/held";

describe("createMessageHandler — dapp grants", () => {
  test("creates pending approvals for ungranted dapp account requests", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", {
      session: createUnlockSession(),
    });

    const held = handler(
      { origin: "https://example.com", type: "wallet.requestAccounts" },
      contentSender,
    );
    await flushHeld();
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toMatchObject({
      pending: [{ origin: "https://example.com" }],
    });
    const id = await latestApprovalId(handler, sender);
    await handler({ id, type: "wallet.denyOrigin" }, sender);
    await expect(held).resolves.toEqual({ error: "connection rejected" });
  });

  test("re-prompts a reconnecting origin whose grant misses the active account", async () => {
    // Regression: connect as account one, disconnect in the dapp, switch to
    // account two in the wallet, reconnect. The stored grant still names only
    // account one, so the site must be re-approved instead of silently getting
    // account one back — and switching back reconnects it with no prompt.
    let activeAccountId = secondAccount.id;
    const handler = createMessageHandler(
      createWallet({
        accounts: [account, secondAccount],
        activeAccountId: () => activeAccountId,
      }),
      "extension-id",
      { session: createUnlockSession() },
    );

    await handler({ type: "wallet.unlock", vaultPassphrase }, sender);
    const held = handler(
      { origin: "https://example.com", type: "wallet.requestAccounts" },
      contentSender,
    );
    await flushHeld();
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toMatchObject({
      pending: [{ origin: "https://example.com" }],
    });
    const id = await latestApprovalId(handler, sender);
    await handler({ id, type: "wallet.denyOrigin" }, sender);
    await expect(held).resolves.toEqual({ error: "connection rejected" });

    activeAccountId = account.id;
    await expect(
      handler({ origin: "https://example.com", type: "wallet.requestAccounts" }, contentSender),
    ).resolves.toEqual({ accounts: [account], ok: true });
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });

  test("returns no accounts without prompting for silent ungranted requests", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", {
      session: createUnlockSession(),
    });

    await expect(
      handler(
        {
          origin: "https://example.com",
          silent: true,
          type: "wallet.requestAccounts",
        },
        contentSender,
      ),
    ).resolves.toEqual({ accounts: [], ok: true });
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });

  test("approves pending dapp account requests after unlock", async () => {
    const captured: OriginGrantInput[] = [];
    const approvals = createApprovalQueue();
    const pending = approvals.request("https://example.com");
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet({ captureGrant: (input) => captured.push(input) }),
      "extension-id",
      { approvals, session },
    );
    const failingHandler = createMessageHandler(
      {
        ...createWallet(),
        async grantOrigin() {
          throw new Error("grant failed");
        },
      },
      "extension-id",
      { approvals, session },
    );

    await handler({ type: "wallet.unlock", vaultPassphrase }, sender);
    await expect(
      failingHandler({ id: pending.id, type: "wallet.approveOrigin" }, sender),
    ).resolves.toEqual({ error: "approval execution failed" });
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toMatchObject({
      ok: true,
      pending: [],
    });
    // A failed claimed approval is terminal and cannot be replayed. The dapp
    // must issue a fresh request, which can then be approved normally.
    const retry = approvals.request("https://example.com");
    await expect(handler({ id: retry.id, type: "wallet.approveOrigin" }, sender)).resolves.toEqual({
      accounts: [account],
      ok: true,
    });
    expect(captured[0]).toMatchObject({
      origin: "https://example.com",
      vaultPassphrase,
    });
    expect(captured[0]?.isAuthorized?.()).toBe(true);
    await expect(handler({ type: "wallet.pendingApprovals" }, sender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });

  test("fails a connect grant whose unlock generation expires during the vault write", async () => {
    const approvals = createApprovalQueue();
    const pending = approvals.request("https://example.com");
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    let checkedBefore = false;
    let checkedAfter = false;
    const handler = createMessageHandler(
      {
        ...createWallet(),
        async grantOrigin(input: OriginGrantInput) {
          checkedBefore = input.isAuthorized?.() === true;
          session.lock();
          checkedAfter = input.isAuthorized?.() === true;
          throw new Error("wallet locked");
        },
      },
      "extension-id",
      { approvals, session },
    );

    await expect(
      handler({ id: pending.id, type: "wallet.approveOrigin" }, sender),
    ).resolves.toEqual({ error: "approval execution failed" });
    expect(checkedBefore).toBe(true);
    expect(checkedAfter).toBe(false);
  });
});
