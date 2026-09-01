/**
 * Central message router fall-through / invalid-input branches: a non-object
 * message with no type, and the per-command "invalid ... request" guards for
 * importAccount (bad input and locked), revealSecrets, getGrantedAccounts,
 * pendingApprovals, requestAccounts, setActiveNetwork, lock, status, and unlock.
 * Complements background-messages.test.ts and privileged-messages.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  contentSender,
  createWallet,
  extensionSender as sender,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const handlerLocked = () =>
  createMessageHandler(createWallet(), "extension-id", { session: createUnlockSession() });

const handlerUnlocked = () => {
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  return createMessageHandler(createWallet(), "extension-id", { session });
};

describe("message router fall-through", () => {
  test("a non-object message has no readable type and is unsupported", async () => {
    await expect(handlerUnlocked()("not-an-object", sender)).resolves.toEqual({
      error: "unsupported message",
    });
  });

  test("an object without a string type is unsupported", async () => {
    await expect(handlerUnlocked()({ type: 42 }, sender)).resolves.toEqual({
      error: "unsupported message",
    });
  });

  test("a wallet.* type handled by no branch falls through to unsupported", async () => {
    await expect(handlerUnlocked()({ type: "wallet.nonexistent" }, sender)).resolves.toEqual({
      error: "unsupported message",
    });
  });

  test("prototype property names are unsupported, never dispatch entries", async () => {
    for (const type of ["constructor", "toString", "__proto__"]) {
      await expect(handlerUnlocked()({ type }, sender)).resolves.toEqual({
        error: "unsupported message",
      });
    }
  });
});

describe("per-command invalid-input guards", () => {
  test("rejects a malformed importAccount request", async () => {
    await expect(
      handlerUnlocked()({ networkId: "SN_SEPOLIA", type: "wallet.importAccount" }, sender),
    ).resolves.toEqual({ error: "invalid import account request" });
  });

  test("a valid importAccount on a locked wallet reports wallet locked", async () => {
    await expect(
      handlerLocked()(
        {
          accountContractType: "openzeppelin",
          networkId: "SN_SEPOLIA",
          privateKey: "0x1",
          type: "wallet.importAccount",
        },
        sender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("rejects a malformed revealSecrets request", async () => {
    await expect(handlerUnlocked()({ type: "wallet.revealSecrets" }, sender)).resolves.toEqual({
      error: "invalid reveal request",
    });
  });

  test("rejects a malformed getGrantedAccounts request", async () => {
    await expect(handlerUnlocked()({ type: "wallet.getGrantedAccounts" }, sender)).resolves.toEqual(
      { error: "invalid granted accounts request" },
    );
  });

  test("rejects a pendingApprovals request carrying extra keys", async () => {
    await expect(
      handlerUnlocked()({ extra: true, type: "wallet.pendingApprovals" }, sender),
    ).resolves.toEqual({ error: "invalid pending approvals request" });
  });

  test("rejects a malformed requestAccounts request", async () => {
    await expect(handlerUnlocked()({ type: "wallet.requestAccounts" }, sender)).resolves.toEqual({
      error: "invalid request accounts request",
    });
  });

  test("rejects a malformed setActiveNetwork request", async () => {
    await expect(handlerUnlocked()({ type: "wallet.setActiveNetwork" }, sender)).resolves.toEqual({
      error: "invalid network request",
    });
  });

  test("rejects a lock request carrying extra keys", async () => {
    await expect(handlerUnlocked()({ extra: 1, type: "wallet.lock" }, sender)).resolves.toEqual({
      error: "invalid lock request",
    });
  });

  test("rejects a status request carrying extra keys", async () => {
    await expect(handlerUnlocked()({ extra: 1, type: "wallet.status" }, sender)).resolves.toEqual({
      error: "invalid status request",
    });
  });

  test("rejects a malformed unlock request", async () => {
    await expect(handlerUnlocked()({ type: "wallet.unlock" }, sender)).resolves.toEqual({
      error: "invalid unlock request",
    });
  });
});

describe("router gate folding and ordered dispatch", () => {
  const untrustedSender: RuntimeSender = {
    id: "other-extension",
    url: "chrome-extension://other-extension/popup.html",
  };

  test("an untrusted sender is rejected before any handler runs", async () => {
    // parseGatedMessage's trusted-sender gate short-circuits: even a perfectly
    // valid status request never reaches the dispatch table.
    await expect(handlerUnlocked()({ type: "wallet.status" }, untrustedSender)).resolves.toEqual({
      error: "untrusted sender",
    });
  });

  test("an undefined sender is untrusted", async () => {
    await expect(handlerUnlocked()({ type: "wallet.status" })).resolves.toEqual({
      error: "untrusted sender",
    });
  });

  test("a privileged message from a content-script sender is rejected", async () => {
    // wallet.status is privileged (not a dapp message); a content-script page
    // sender is trusted but not an extension page, so the privileged gate fires.
    await expect(handlerUnlocked()({ type: "wallet.status" }, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("dispatch reaches a late handler through the first-non-null loop", async () => {
    // wallet.status sits near the end of the ordered table; resolving it proves
    // the loop iterates past every earlier handler that returns null.
    await expect(handlerUnlocked()({ type: "wallet.status" }, sender)).resolves.toMatchObject({
      locked: false,
    });
  });
});
