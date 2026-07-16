/**
 * Error/guard branches inside the otherwise-covered vault methods:
 * missing-account lookups, no-account-selected returns, a KMS that yields an
 * invalid derived address, the ensure-network existing-account short circuit,
 * and duplicate-account rejections.
 */
import { describe, expect, test } from "bun:test";
import type { KrustyKms } from "../src/crypto/krusty";
import { createEncryptedStore } from "../src/storage/encrypted-store";
import { createMemoryStore } from "../src/storage/kv";
import type { Vault } from "../src/storage/vault-schema";
import { emptyVault } from "../src/storage/vault-schema";
import { activeAccountSecrets, createWalletVaultService } from "../src/wallet/vault-service";
import { fakeKms } from "./fake-kms";

const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
const vaultKey = "mc-wallet:vault";
const vaultPassphrase = "correct horse battery staple";

const makeService = (kms: KrustyKms = fakeKms()) => {
  const store = createMemoryStore();
  const encryptedStore = createEncryptedStore(store, vaultKey);
  const service = createWalletVaultService({ encryptedStore, kms });
  return { encryptedStore, service };
};

// Seeds an already-persisted empty vault (no accounts, no active account) so
// the no-account-selected branches can be reached — a fresh store would throw
// on read instead.
const seedEmptyService = async () => {
  const store = createMemoryStore();
  const encryptedStore = createEncryptedStore(store, vaultKey);
  await encryptedStore.write(emptyVault(), vaultPassphrase);
  return createWalletVaultService({ encryptedStore, kms: fakeKms() });
};

describe("vault service guard branches", () => {
  test("setActiveAccount throws when the account id is absent", async () => {
    const { service } = makeService();
    await service.createAccount({ mnemonic, vaultPassphrase });
    await expect(
      service.setActiveAccount({ accountId: "SN_MAIN:0x9", vaultPassphrase }),
    ).rejects.toThrow("Account not found");
  });

  test("createAccount rejects a duplicate account id", async () => {
    // The fake KMS returns a constant keypair, so a second createAccount derives
    // the same address/id.
    const { service } = makeService();
    await service.createAccount({ mnemonic, vaultPassphrase });
    await expect(service.createAccount({ mnemonic, vaultPassphrase })).rejects.toThrow(
      "Account already exists",
    );
  });

  test("addDerivedAccount rejects when the derived id already exists", async () => {
    const { service } = makeService();
    await service.createAccount({ mnemonic, vaultPassphrase });
    await expect(
      service.addDerivedAccount({ networkId: "SN_MAIN", vaultPassphrase }),
    ).rejects.toThrow("Account already exists");
  });

  test("ensureNetworkAccount throws when the vault has no source account", async () => {
    const service = await seedEmptyService();
    await expect(
      service.ensureNetworkAccount({ networkId: "SN_MAIN", vaultPassphrase }),
    ).rejects.toThrow("No account selected");
  });

  test("ensureNetworkAccount returns the existing same-network account", async () => {
    const { service } = makeService();
    const created = await service.createAccount({ mnemonic, vaultPassphrase });
    const same = await service.ensureNetworkAccount({ networkId: "SN_MAIN", vaultPassphrase });
    expect(same.id).toBe(created.id);
  });

  test("ensureNetworkAccount throws when the KMS returns an invalid address", async () => {
    // The SN_SEPOLIA OZ class hash routes to a zero (invalid) derived address.
    const badKms: KrustyKms = {
      ...fakeKms(),
      async deriveOzAccountAddress(publicKeyX, classHash) {
        return classHash === "0xabcdef"
          ? "0x0"
          : `0x${publicKeyX.slice(2)}${classHash.slice(2, 8)}`;
      },
    };
    const { service } = makeService(badKms);
    await service.createAccount({ mnemonic, networkId: "SN_MAIN", vaultPassphrase });
    await expect(
      service.ensureNetworkAccount({ networkId: "SN_SEPOLIA", vaultPassphrase }),
    ).rejects.toThrow("invalid account address");
  });

  test("grantOrigin throws when no account is selected", async () => {
    const service = await seedEmptyService();
    await expect(
      service.grantOrigin({ origin: "https://dapp.example", vaultPassphrase }),
    ).rejects.toThrow("No account selected");
  });

  test("signHash throws when no account is selected", async () => {
    const service = await seedEmptyService();
    await expect(service.signHash({ messageHash: "0x1", vaultPassphrase })).rejects.toThrow(
      "No account selected",
    );
  });
});

describe("activeAccountSecrets guard branches", () => {
  test("throws when no account is selected", () => {
    expect(() => activeAccountSecrets(emptyVault())).toThrow("No account selected");
  });

  test("throws when the active account has no signing key", () => {
    const vault = {
      ...emptyVault(),
      activeAccountId: "SN_MAIN:0x1",
      signingKeys: [],
    } as unknown as Vault;
    expect(() => activeAccountSecrets(vault)).toThrow("Signing key unavailable");
  });
});
