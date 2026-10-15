/**
 * `wallet.addAccount` on a vault with no recovery phrase (Sherlock 156).
 *
 * The add-account chooser offers "Regular account" to every vault, but one
 * set up from a Ledger or a private key has no phrase to derive from. The
 * refusal used to come from inside the guarded network mutation, which writes
 * the requested network first and locks the session on any error, so the
 * choice signed the user out and could switch their network. The handler now
 * refuses before that mutation starts.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";
import { createWalletReader } from "../../../apps/extension/src/background/accounts/wallet-reader";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  extensionSender as sender,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";

const ledgerWallet = async () => {
  const service = createWalletVaultService({
    encryptedStore: createEncryptedStore(createMemoryStore(), "bramble:vault"),
    kms: fakeKms(),
    migrationStore: createEncryptedStore(createMemoryStore(), "bramble:vault-migration"),
  });
  await service.createLedgerVault({
    accountContractType: "openzeppelin",
    accountIndex: 0,
    networkId: "SN_MAIN",
    publicKeyX: "0xdef123",
    vaultPassphrase,
  });
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_MAIN");
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const handler = createMessageHandler(
    createWalletReader(Promise.resolve(service)),
    testExtension,
    {
      preferencesStore,
      session,
    },
  );
  return { handler, preferencesStore, service, session };
};

describe("wallet.addAccount without a recovery phrase", () => {
  test("refuses without locking the session or switching the network", async () => {
    const { handler, preferencesStore, service, session } = await ledgerWallet();
    const before = (await service.readVault(vaultPassphrase)).accounts;

    await expect(
      handler(
        { accountContractType: "openzeppelin", networkId: "SN_SEPOLIA", type: "wallet.addAccount" },
        sender,
      ),
    ).resolves.toEqual({ error: "No recovery phrase stored for this wallet" });

    expect(session.isUnlocked()).toBe(true);
    expect((await preferencesStore.read()).activeNetworkId).toBe("SN_MAIN");
    expect((await service.readVault(vaultPassphrase)).accounts).toEqual(before);
  });

  test("reports the wallet locked while it is locked", async () => {
    const { handler, session } = await ledgerWallet();
    session.lock();
    await expect(
      handler(
        { accountContractType: "openzeppelin", networkId: "SN_MAIN", type: "wallet.addAccount" },
        sender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
  });

  test("uses the refusal the vault service raises, verbatim", async () => {
    const { service } = await ledgerWallet();
    await expect(
      service.addDerivedAccount({
        accountContractType: "openzeppelin",
        networkId: "SN_MAIN",
        vaultPassphrase,
      }),
    ).rejects.toThrow("No recovery phrase stored for this wallet");
  });
});
