/**
 * `wallet.createKeyVault` routing checks: the first-run raw-key vault creation
 * is extension-page-only, parses through the shared raw-key grammar without
 * echoing the key, reaches the wallet service exactly once with the canonical
 * key, unlocks the session on success, and fails closed when the wallet
 * surface is unavailable.
 */
import { describe, expect, test } from "bun:test";
import type { CreateKeyVaultInput } from "@bramble/vault/service";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  extensionSender as sender,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

// Clearly-fake test vector; not a real key.
const privateKey = "0xfeedface";

const validMessage = {
  accountContractType: "openzeppelin",
  networkId: "SN_MAIN",
  privateKey,
  type: "wallet.createKeyVault",
  vaultPassphrase,
} as const;

describe("wallet.createKeyVault routing", () => {
  test("creates the key vault through the wallet service and unlocks the session", async () => {
    const captured: CreateKeyVaultInput[] = [];
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet({ captureCreateKeyVault: (input) => captured.push(input) }),
      "extension-id",
      { session },
    );

    await expect(handler(validMessage, sender)).resolves.toEqual({ account, ok: true });
    expect(captured).toEqual([
      {
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        privateKey,
        vaultPassphrase,
      },
    ]);
    expect(session.getPassphrase()).toBe(vaultPassphrase);
  });

  test("rejects malformed requests without echoing the key", async () => {
    const captured: CreateKeyVaultInput[] = [];
    const session = createUnlockSession();
    const handler = createMessageHandler(
      createWallet({ captureCreateKeyVault: (input) => captured.push(input) }),
      "extension-id",
      { session },
    );
    const rejected = [
      // No vault passphrase: first-run creation has no session to take it from.
      { ...validMessage, vaultPassphrase: undefined },
      // Short passphrases never reach the vault.
      { ...validMessage, vaultPassphrase: "short" },
      // A deployment salt is Ready-only; the Bramble contract refuses it.
      { ...validMessage, deploymentSalt: "0x1" },
      // Unknown keys are rejected wholesale at the trust boundary.
      { ...validMessage, extra: true },
      // An out-of-range key never reaches Krusty.
      { ...validMessage, privateKey: "0x0" },
    ];
    for (const message of rejected) {
      const response = await handler(message, sender);
      expect(response).toEqual({ error: "invalid create key vault request" });
      expect(JSON.stringify(response)).not.toContain("feedface");
    }
    expect(captured).toEqual([]);
    expect(session.getPassphrase()).toBeNull();
  });

  test("accepts a Ready account with its exact deployment salt", async () => {
    const captured: CreateKeyVaultInput[] = [];
    const handler = createMessageHandler(
      createWallet({ captureCreateKeyVault: (input) => captured.push(input) }),
      "extension-id",
    );
    await expect(
      handler({ ...validMessage, accountContractType: "argent", deploymentSalt: "0xabc" }, sender),
    ).resolves.toEqual({ account, ok: true });
    expect(captured[0]?.deploymentSalt).toBe("0xabc");
  });

  test("is privileged: content scripts cannot reach it", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");
    await expect(handler(validMessage, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("fails closed when the wallet surface lacks createKeyVault", async () => {
    const { createKeyVault: _omitted, ...withoutCreate } = createWallet();
    const handler = createMessageHandler(withoutCreate, "extension-id");
    await expect(handler(validMessage, sender)).resolves.toEqual({ error: "wallet unavailable" });
  });
});
