/**
 * Central message router fall-through / invalid-input branches: a non-object
 * message with no type, and the per-command "invalid ... request" guards for
 * importAccount (bad input and locked), revealSecrets, getGrantedAccounts,
 * pendingApprovals, requestAccounts, setActiveNetwork, lock, status, and unlock.
 * Complements background-messages.test.ts and privileged-messages.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../src/background/messages";
import { createUnlockSession } from "../src/background/session";
import {
  createWallet,
  extensionSender as sender,
  vaultPassphrase,
} from "./support/background-wallet-stub";

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
        { networkId: "SN_SEPOLIA", privateKey: "0x1", type: "wallet.importAccount" },
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
