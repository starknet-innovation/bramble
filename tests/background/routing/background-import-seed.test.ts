/**
 * `wallet.importSeedAccounts` routing checks: the in-wallet phrase import is
 * extension-page-only, requires an unlocked session (the vault passphrase
 * comes from the session, never the message), rejects malformed input without
 * echoing the phrase, and reaches the wallet service exactly once.
 */
import { describe, expect, test } from "bun:test";
import type { RecoverVaultAccountsInput } from "@bramble/vault/service";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  extensionSender as sender,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const mnemonic = "legal winner thank year wave sausage worth useful legal winner thank yellow";

const validMessage = {
  mnemonic,
  networkId: "SN_MAIN",
  selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
  type: "wallet.importSeedAccounts",
} as const;

const capturingWallet = (captured: RecoverVaultAccountsInput[]) => ({
  ...createWallet(),
  async importSeedAccounts(input: RecoverVaultAccountsInput) {
    captured.push(input);
    return [account];
  },
});

describe("wallet.importSeedAccounts routing", () => {
  test("imports through the wallet service with the session passphrase", async () => {
    const captured: RecoverVaultAccountsInput[] = [];
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(capturingWallet(captured), "extension-id", { session });

    await expect(handler(validMessage, sender)).resolves.toEqual({
      accounts: [account],
      ok: true,
    });
    expect(captured).toEqual([
      {
        mnemonic,
        networkId: "SN_MAIN",
        selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
        vaultPassphrase,
      },
    ]);
  });

  test("fails closed when the wallet is locked", async () => {
    const captured: RecoverVaultAccountsInput[] = [];
    const handler = createMessageHandler(capturingWallet(captured), "extension-id", {
      session: createUnlockSession(),
    });
    await expect(handler(validMessage, sender)).resolves.toEqual({ error: "wallet locked" });
    expect(captured).toEqual([]);
  });

  test("rejects malformed requests without echoing the phrase", async () => {
    const captured: RecoverVaultAccountsInput[] = [];
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(capturingWallet(captured), "extension-id", { session });
    const rejected = [
      // A message-supplied passphrase is refused wholesale: the session owns it.
      { ...validMessage, vaultPassphrase },
      { ...validMessage, selections: [] },
      { ...validMessage, selections: [{ accountContractType: "evil", accountIndex: 0 }] },
      { ...validMessage, mnemonic: 42 },
      { ...validMessage, networkId: "NOPE" },
    ];
    for (const message of rejected) {
      const response = await handler(message, sender);
      expect(response).toEqual({ error: "invalid import seed accounts request" });
      expect(JSON.stringify(response)).not.toContain("winner");
    }
    expect(captured).toEqual([]);
  });

  test("is privileged: content scripts cannot reach it", async () => {
    const handler = createMessageHandler(createWallet(), "extension-id");
    await expect(handler(validMessage, contentSender)).resolves.toEqual({
      error: "privileged sender required",
    });
  });

  test("fails closed when the wallet surface lacks the import", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(createWallet(), "extension-id", { session });
    await expect(handler(validMessage, sender)).resolves.toEqual({ error: "wallet unavailable" });
  });
});
