/**
 * Sender trust-gate checks: untrusted senders, accessor message types,
 * privileged-message rejection for content scripts, origin claims, and
 * error scrubbing at the dispatch boundary: a page sender gets a fixed line,
 * and an extension page gets the error with its endpoints redacted.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";

import {
  contentSender,
  createWallet,
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../../support/held";

describe("background sender gates", () => {
  test("rejects untrusted senders", async () => {
    const handler = createMessageHandler(createWallet(), testExtension);

    await expect(handler({ type: "wallet.status" }, { id: "other-extension" })).resolves.toEqual({
      error: "untrusted sender",
    });
  });

  test("rejects accessor message types before dispatch", async () => {
    const handler = createMessageHandler(createWallet(), testExtension);
    const message = {};
    Object.defineProperty(message, "type", {
      enumerable: true,
      get() {
        throw new Error("type getter executed");
      },
    });

    await expect(handler(message, sender)).resolves.toEqual({ error: "unsupported message" });
  });

  test("rejects privileged commands from content senders", async () => {
    const handler = createMessageHandler(createWallet(), testExtension);

    // A vault read is the sharpest privileged command: it decrypts the vault
    // and returns key material, so it must never dispatch for a page sender.
    const response = await handler(
      { type: "wallet.revealSecrets", vaultPassphrase },
      contentSender,
    );
    expect(response).toEqual({ error: "privileged sender required" });
    expect(JSON.stringify(response)).not.toContain("privateKey");
  });

  test("rejects status reads from content senders", async () => {
    const handler = createMessageHandler(createWallet(), testExtension);

    await expect(handler({ type: "wallet.status" }, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("rejects extension-page URL prefix matches from other senders", async () => {
    const handler = createMessageHandler(createWallet(), testExtension);

    await expect(
      handler(
        { type: "wallet.revealSecrets", vaultPassphrase },
        {
          id: "other-extension",
          url: "chrome-extension://extension-id-other/popup.html",
        },
      ),
    ).resolves.toEqual({ error: "untrusted sender" });
  });

  test("allows content senders to use the provider account request path", async () => {
    const handler = createMessageHandler(createWallet(), testExtension, {
      session: createUnlockSession(),
    });

    // A locked wallet cannot read grants, so the request holds behind a queued
    // connection approval rather than resolving immediately.
    const held = handler(
      { origin: "https://example.com", type: "wallet.requestAccounts" },
      contentSender,
    );
    await flushHeld();
    const id = await latestApprovalId(handler, sender);
    await handler({ id, type: "wallet.denyOrigin" }, sender);
    await expect(held).resolves.toEqual({ error: "connection rejected" });
  });

  test("rejects content senders claiming a different origin", async () => {
    const handler = createMessageHandler(createWallet(), testExtension, {
      session: createUnlockSession(),
    });

    await expect(
      handler({ origin: "https://evil.example", type: "wallet.requestAccounts" }, contentSender),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("rejects explicit passphrases from content senders", async () => {
    const handler = createMessageHandler(createWallet(), testExtension, {
      session: createUnlockSession(),
    });

    await expect(
      handler(
        {
          origin: "https://example.com",
          type: "wallet.getGrantedAccounts",
          vaultPassphrase,
        },
        contentSender,
      ),
    ).resolves.toEqual({ error: "privileged sender required" });
  });

  test("rejects granted account reads for a mismatched content origin", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(createWallet(), testExtension, { session });

    await expect(
      handler({ origin: "https://evil.example", type: "wallet.getGrantedAccounts" }, contentSender),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("scrubs wallet errors for content senders", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(
      {
        ...createWallet(),
        async getGrantedAccounts() {
          throw new Error("vault schema details");
        },
      },
      testExtension,
      { session },
    );

    await expect(
      handler({ origin: "https://example.com", type: "wallet.getGrantedAccounts" }, contentSender),
    ).resolves.toEqual({ error: "wallet request failed" });
  });

  test("redacts endpoints from the errors it reveals to extension pages", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    // A node's own failure text, echoing the configured RPC URL and its key.
    const failing = {
      ...createWallet(),
      async status(): Promise<never> {
        throw new Error(
          "RPC: starknet_chainId failed at https://rpc.example.test/v0_8/node-key-123",
        );
      },
    };
    const handler = createMessageHandler(failing, testExtension, { session });

    await expect(handler({ type: "wallet.status" }, sender)).resolves.toEqual({
      error: "RPC: starknet_chainId failed at [endpoint]",
    });
  });

  test("keeps wallet errors actionable for extension pages", async () => {
    const handler = createMessageHandler(createWallet(), testExtension);

    await expect(
      handler({ type: "wallet.unlock", vaultPassphrase: "wrong passphrase" }, sender),
    ).resolves.toEqual({ error: "bad passphrase" });
  });
});
