/** Nostr identity operations derive on demand without changing the vault schema. */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { fakeKms } from "@mc-wallet/testkit/fake-kms";
import { createEncryptedStore } from "@mc-wallet/vault/encrypted-store";
import type { KmsPort } from "@mc-wallet/vault/kms-port";
import { createWalletVaultService } from "@mc-wallet/vault/service";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";

const serviceFor = (kms: KmsPort, store = createMemoryStore()) =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(store, "mc-wallet:vault"),
    kms,
    migrationStore: createEncryptedStore(store, "mc-wallet:vault-migration"),
  });

describe("wallet Nostr identity", () => {
  test("derives and uses the wallet-level Nostr path inside Krusty", async () => {
    const calls: unknown[][] = [];
    const kms: KmsPort = {
      ...fakeKms(),
      async deriveNostrPublicKey(...args) {
        calls.push(args);
        return "11".repeat(32);
      },
      async openNostrApplicationData(...args) {
        calls.push(args);
        return {
          content: "payload",
          identifier: "mc-wallet.multisig",
          senderPublicKey: "22".repeat(32),
        };
      },
      async wrapNostrApplicationData(...args) {
        calls.push(args);
        return fakeKms().wrapNostrApplicationData(...args);
      },
    };
    const service = serviceFor(kms);
    await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      vaultPassphrase,
    });
    const wrapped = await service.wrapNostrApplicationData({
      content: "payload",
      identifier: "mc-wallet.multisig",
      recipientPublicKey: "44".repeat(32),
      vaultPassphrase,
    });

    await expect(service.nostrPublicKey(vaultPassphrase)).resolves.toBe("11".repeat(32));
    await expect(
      service.openNostrApplicationData({ eventJson: wrapped, vaultPassphrase }),
    ).resolves.toMatchObject({ content: "payload" });
    expect(calls).toEqual([
      [mnemonic, 0, 0, "44".repeat(32), "mc-wallet.multisig", "payload"],
      [mnemonic, 0, 0],
      [mnemonic, 0, 0, wrapped],
    ]);
  });

  test("fails closed for a mnemonic-less vault", async () => {
    const store = createMemoryStore();
    const encryptedStore = createEncryptedStore(store, "mc-wallet:vault");
    await encryptedStore.write(
      { accounts: [], activeAccountId: null, originGrants: [], schemaVersion: 1, signingKeys: [] },
      vaultPassphrase,
    );
    const service = createWalletVaultService({
      encryptedStore,
      kms: fakeKms(),
      migrationStore: createEncryptedStore(store, "mc-wallet:vault-migration"),
    });

    await expect(service.nostrPublicKey(vaultPassphrase)).rejects.toThrow(
      "Nostr coordination requires a recovery-phrase wallet",
    );
    await expect(
      service.wrapNostrApplicationData({
        content: "payload",
        identifier: "mc-wallet.multisig",
        recipientPublicKey: "44".repeat(32),
        vaultPassphrase,
      }),
    ).rejects.toThrow("Nostr coordination requires a recovery-phrase wallet");
  });
});
