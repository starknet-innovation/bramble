/**
 * MCW-V09-124 regression: two privileged message types shipped with no
 * production caller. `wallet.signHash` signed any field element with the account
 * key on nothing but a valid passphrase — no approval, no domain separation, an
 * arbitrary-hash signing oracle behind whatever could reach an extension page.
 * `wallet.grantOrigin` minted an origin grant with no user decision. Both are
 * removed; hash signing stays reachable only through the in-background
 * account-hash-signer bound to a reviewed operation, and grants only through the
 * approval decision path. This suite pins that they cannot come back as message
 * types without someone deleting a failing test.
 */
import { describe, expect, test } from "bun:test";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { isPrivilegedMessage } from "../../apps/extension/src/background/routing/senders";
import {
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  vaultPassphrase,
} from "../support/background-wallet-stub";
import { handledWalletMessages } from "../support/key-boundary-messages";

const REMOVED_TYPES = ["wallet.grantOrigin", "wallet.signHash"] as const;

describe("callerless privileged messages", () => {
  test("the background dispatches no arbitrary-hash signing message", async () => {
    const signed: unknown[] = [];
    const handler = createMessageHandler(
      createWallet({ captureSign: (input) => signed.push(input) }),
      "extension-id",
    );

    await expect(
      handler(
        {
          messageHash: "0x1234",
          type: "wallet.signHash",
          vaultPassphrase,
        },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "unsupported message" });
    // The account key must not have been touched on the way to that rejection.
    expect(signed).toEqual([]);
  });

  test("the background dispatches no direct origin-grant message", async () => {
    const granted: unknown[] = [];
    const handler = createMessageHandler(
      createWallet({ captureGrant: (input) => granted.push(input) }),
      "extension-id",
    );

    await expect(
      handler(
        {
          origin: grantedOrigin,
          type: "wallet.grantOrigin",
          vaultPassphrase,
        },
        extensionSender,
      ),
    ).resolves.toEqual({ error: "unsupported message" });
    expect(granted).toEqual([]);
  });

  test("neither type is reachable from a content script either", async () => {
    const signed: unknown[] = [];
    const granted: unknown[] = [];
    const handler = createMessageHandler(
      createWallet({
        captureGrant: (input) => granted.push(input),
        captureSign: (input) => signed.push(input),
      }),
      "extension-id",
    );

    for (const type of REMOVED_TYPES) {
      // Deny-by-default keeps them privileged even with no handler, so a page
      // is turned away at the gate rather than reaching the dispatch table.
      expect(isPrivilegedMessage(type)).toBe(true);
      await expect(
        handler(
          { messageHash: "0x1234", origin: grantedOrigin, type, vaultPassphrase },
          contentSender,
        ),
      ).resolves.toEqual({ error: "privileged sender required" });
    }
    expect(signed).toEqual([]);
    expect(granted).toEqual([]);
  });

  test("no background source handles either type", async () => {
    // Derived from the src/background literals, so re-adding a handler fails
    // here rather than waiting for a reviewer to notice.
    const handled = await handledWalletMessages();
    expect(REMOVED_TYPES.filter((type) => handled.has(type))).toEqual([]);
  });
});
