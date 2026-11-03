/**
 * The vault service generates a multisig viewing key through Krusty, keeps it
 * encrypted, and does not rotate it. A different offer conflicts.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { fakeKms } from "@bramble/testkit/fake-kms";
import { createEncryptedStore } from "@bramble/vault/encrypted-store";
import { createWalletVaultService } from "@bramble/vault/service";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultPassphrase = "correct horse battery staple";
const chainId = STARKNET_NETWORKS.SN_MAIN.chainId;
const poolAddress = "0x123";

const makeService = () =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(createMemoryStore(), "bramble:vault"),
    kms: fakeKms(),
    migrationStore: createEncryptedStore(createMemoryStore(), "bramble:vault-migration"),
  });

describe("multisig STRK20 viewing key service", () => {
  test("creates one key, keeps it, and conflicts on a different offer", async () => {
    const store = createMemoryStore();
    const watching = createWalletVaultService({
      encryptedStore: createEncryptedStore(store, "bramble:vault"),
      kms: fakeKms(),
      migrationStore: createEncryptedStore(createMemoryStore(), "bramble:vault-migration"),
    });
    await watching.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      vaultPassphrase,
    });
    const multisigId = "SN_MAIN:0xabc";
    const input = { chainId, multisigId, poolAddress, vaultPassphrase };
    expect(await watching.multisigStrk20KeyStatus(input)).toBe("absent");
    expect(await watching.createMultisigStrk20Key(input)).toBe("created");
    expect(await watching.createMultisigStrk20Key(input)).toBe("held");
    const vault = await watching.readVault(vaultPassphrase);
    expect(vault.multisigStrk20ViewingKeys).toEqual([
      {
        chainId,
        multisigId,
        poolAddress,
        scheme: "multisig-strk20-shared-v1",
        viewingKey: "0x654321",
      },
    ]);
    expect(JSON.stringify(await store.get("bramble:vault"))).not.toContain("0x654321");
    expect(await watching.acceptMultisigStrk20Key({ ...input, key: "0x654321" })).toBe("held");
    expect(await watching.acceptMultisigStrk20Key({ ...input, key: "0x111" })).toBe("conflict");
    expect(await watching.multisigStrk20KeyStatus(input)).toBe("conflict");
    expect(
      (await watching.readVault(vaultPassphrase)).multisigStrk20ViewingKeys[0]?.viewingKey,
    ).toBe("0x654321");
    const content = await watching.packageMultisigStrk20Key(input);
    expect(content).toContain("0x654321");
    expect(await watching.forgetMultisigStrk20Key(input)).toBe(true);
    expect(await watching.multisigStrk20KeyStatus(input)).toBe("absent");
    expect(await watching.acceptMultisigStrk20Key({ ...input, key: "0x111" })).toBe("stored");
  });

  test("refuses a key for a chain the multisig id does not name", async () => {
    const service = makeService();
    await service.createAccount({
      accountContractType: "openzeppelin",
      mnemonic,
      vaultPassphrase,
    });
    await expect(
      service.createMultisigStrk20Key({
        chainId: STARKNET_NETWORKS.SN_SEPOLIA.chainId,
        multisigId: "SN_MAIN:0xabc",
        poolAddress,
        vaultPassphrase,
      }),
    ).rejects.toThrow("Invalid multisig STRK20 key");
  });
});
