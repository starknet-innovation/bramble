/**
 * Sender trust-gate checks: untrusted senders, accessor message types,
 * privileged-message rejection for content scripts, origin claims, and
 * error scrubbing at the dispatch boundary.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../src/background/messages";
import { createUnlockSession } from "../../src/background/session";
import type { SignHashInput } from "../../src/wallet/vault-service";
import {
  contentSender,
  createWallet,
  extensionSender as sender,
  vaultPassphrase,
} from "../support/background-wallet-stub";
import { flushHeld, latestApprovalId } from "../support/held";

describe("background sender gates", () => {
  test("rejects untrusted senders", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(handler({ type: "wallet.status" }, { id: "other-extension" })).resolves.toEqual({
      error: "untrusted sender",
    });
  });

  test("rejects accessor message types before dispatch", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");
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
    const captured: SignHashInput[] = [];
    const handler = createMessageHandler(
      createWallet({ captureSign: (input) => captured.push(input) }),
      "extension-id",
    );

    await expect(
      handler(
        {
          messageHash: "0x1234",
          type: "wallet.signHash",
          vaultPassphrase,
        },
        contentSender,
      ),
    ).resolves.toEqual({ error: "privileged sender required" });
    expect(captured).toEqual([]);
  });

  test("rejects status reads from content senders", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(handler({ type: "wallet.status" }, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("rejects extension-page URL prefix matches from other senders", async () => {
    const captured: SignHashInput[] = [];
    const handler = createMessageHandler(
      createWallet({ captureSign: (input) => captured.push(input) }),
      "extension-id",
    );

    await expect(
      handler(
        {
          messageHash: "0x1234",
          type: "wallet.signHash",
          vaultPassphrase,
        },
        {
          id: "other-extension",
          url: "chrome-extension://extension-id-other/popup.html",
        },
      ),
    ).resolves.toEqual({ error: "untrusted sender" });
    expect(captured).toEqual([]);
  });

  test("allows content senders to use the provider account request path", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", {
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
    const handler = createMessageHandler(createWallet(), "extension-id", {
      session: createUnlockSession(),
    });

    await expect(
      handler({ origin: "https://evil.example", type: "wallet.requestAccounts" }, contentSender),
    ).resolves.toEqual({ error: "sender origin mismatch" });
  });

  test("rejects explicit passphrases from content senders", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id", {
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
    const handler = createMessageHandler(createWallet(), "extension-id", { session });

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
      "extension-id",
      { session },
    );

    await expect(
      handler({ origin: "https://example.com", type: "wallet.getGrantedAccounts" }, contentSender),
    ).resolves.toEqual({ error: "wallet request failed" });
  });

  test("keeps wallet errors actionable for extension pages", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");

    await expect(
      handler({ type: "wallet.unlock", vaultPassphrase: "wrong passphrase" }, sender),
    ).resolves.toEqual({ error: "bad passphrase" });
  });
});
