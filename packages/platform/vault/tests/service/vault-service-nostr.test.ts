/** Nostr identity operations derive on demand without changing the vault schema. */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import type { KmsPort } from "@bramble/vault/kms-port";
import type { Vault } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { nostrWalletMethods } from "../../src/service/nostr";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";

const serviceFor = (kms: KmsPort, store = createMemoryStore()) =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(store, "mc-wallet:vault"),
    kms,
    migrationStore: createEncryptedStore(store, "mc-wallet:vault-migration"),
  });

describe("wallet Nostr identity", () => {
  test("opens and wraps a batch with one vault read while retaining per-item failures", async () => {
    let vaultReads = 0;
    let wraps = 0;
    const methods = nostrWalletMethods(
      {
        ...fakeKms(),
        async openNostrApplicationData(_mnemonic, _address, _account, eventJson) {
          if (eventJson === "invalid") throw new Error("invalid gift wrap");
          return {
            content: eventJson,
            identifier: "mc-wallet.multisig",
            senderPublicKey: "22".repeat(32),
          };
        },
        async wrapNostrApplicationData() {
          wraps += 1;
          return `wrapped-${wraps}`;
        },
      },
      async () => {
        vaultReads += 1;
        return { mnemonic } as Vault;
      },
    );
    const isAuthorized = () => true;

    await expect(
      methods.wrapNostrApplicationDataBatch({
        isAuthorized,
        items: ["44", "55"].map((prefix) => ({
          content: "payload",
          identifier: "mc-wallet.multisig",
          recipientPublicKey: prefix.repeat(32),
        })),
        vaultPassphrase,
      }),
    ).resolves.toEqual(["wrapped-1", "wrapped-2"]);
    await expect(
      methods.openNostrApplicationDataBatch({
        eventJsons: ["valid", "invalid"],
        isAuthorized,
        vaultPassphrase,
      }),
    ).resolves.toEqual([
      {
        content: "valid",
        identifier: "mc-wallet.multisig",
        senderPublicKey: "22".repeat(32),
      },
      null,
    ]);
    expect(vaultReads).toBe(2);
  });

  test("aborts a Nostr batch when its authorizing session changes", async () => {
    let authorized = true;
    let wraps = 0;
    const methods = nostrWalletMethods(
      {
        ...fakeKms(),
        async wrapNostrApplicationData() {
          wraps += 1;
          authorized = false;
          return "wrapped";
        },
      },
      async () => ({ mnemonic }) as Vault,
    );

    await expect(
      methods.wrapNostrApplicationDataBatch({
        isAuthorized: () => authorized,
        items: ["44", "55"].map((prefix) => ({
          content: "payload",
          identifier: "mc-wallet.multisig",
          recipientPublicKey: prefix.repeat(32),
        })),
        vaultPassphrase,
      }),
    ).rejects.toThrow("wallet locked");
    expect(wraps).toBe(1);
  });

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
