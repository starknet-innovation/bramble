/**
 * Schema v8 admits the keyless paired-phone account, and no earlier version
 * does. The v7 to v8 step rewrites nothing but the stamp, so the risk is not
 * data loss — it is a v7 vault quietly accepting a record it has no validator
 * for, or v8 accepting one that claims a vault-held key it cannot have. Covers
 * old, current, and invalid data, plus the staged commit, restart recovery, and
 * idempotence the migration workflow requires.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { deriveAccountContractAddress } from "@mc-wallet/vault/accounts";
import { createEncryptedStore } from "@mc-wallet/vault/encrypted-store";
import {
  CURRENT_SCHEMA_VERSION,
  migrateVault,
  VAULT_MIGRATIONS,
} from "@mc-wallet/vault/migrations";
import { isVaultV7, isVaultV8 } from "@mc-wallet/vault/schema";
import {
  readMigratedVault,
  VAULT_MIGRATION_STORE_KEY,
  VAULT_STORE_KEY,
} from "@mc-wallet/vault/store-migration";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import { ML_DSA_65_PUBLIC_KEY_BYTES } from "@mc-wallet/wallet-model/signing";

const vaultPassphrase = "correct horse battery staple";

const mobileAccount = {
  accountContractType: "ml-dsa" as const,
  address: "0xdef",
  classHash: "0xabc",
  derivation: {
    deviceId: "phone-1",
    kind: "mobile-pq" as const,
    transport: { kind: "clipboard" as const },
  },
  id: "SN_MAIN:0xdef",
  networkId: "SN_MAIN" as const,
  publicKey: `0x${"ab".repeat(ML_DSA_65_PUBLIC_KEY_BYTES)}`,
  publicKeyX: "0x456",
};

const softwareAccount = {
  accountContractType: "openzeppelin" as const,
  address: "0x123",
  classHash: "0xabc",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" as const },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN" as const,
  publicKeyX: "0x456",
  publicKeyY: "0x789",
};

const v7 = {
  accounts: [softwareAccount],
  accountSecrets: [],
  activeAccountId: softwareAccount.id,
  mnemonic: null,
  originGrants: [],
  schemaVersion: 7 as const,
  signingKeys: [{ accountId: softwareAccount.id, privateKey: "0x654321" }],
};

const withMobile = <T extends typeof v7>(vault: T) => ({
  ...vault,
  accounts: [...vault.accounts, mobileAccount],
});

describe("schema version 8", () => {
  test("the plan reaches 8 with one adjacent step from 7", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(8);
    const step = VAULT_MIGRATIONS.find((migration) => migration.fromVersion === 7);
    expect(step?.toVersion).toBe(8);
  });

  test("v7 refuses a paired-phone account and v8 accepts it", () => {
    expect(isVaultV7(v7)).toBe(true);
    expect(isVaultV7(withMobile(v7))).toBe(false);
    const v8 = { ...withMobile(v7), schemaVersion: 8 };
    expect(isVaultV8(v8)).toBe(true);
    expect(isVaultV8(withMobile(v7))).toBe(false);
  });

  test("a paired-phone account may not claim a vault-held key or a secret", () => {
    const v8 = { ...withMobile(v7), schemaVersion: 8 };
    expect(
      isVaultV8({
        ...v8,
        signingKeys: [...v8.signingKeys, { accountId: mobileAccount.id, privateKey: "0x99" }],
      }),
    ).toBe(false);
    expect(
      isVaultV8({
        ...v8,
        accountSecrets: [
          {
            accountId: mobileAccount.id,
            ledgerStrk20ViewingKeys: [
              { chainId: "0x534e5f4d41494e", poolAddress: "0x1", viewingKey: "0x2" },
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  test("a v7 vault migrates by stamp alone, and again idempotently", () => {
    const once = migrateVault(v7);
    expect(isVaultV8(once)).toBe(true);
    expect(once).toEqual({ ...v7, schemaVersion: 8 });
    expect(once).not.toBe(v7);
    expect(migrateVault(once)).toBe(once);
  });

  test("a v7 source is refused if it carries a record only v8 allows", () => {
    expect(() => migrateVault(withMobile(v7))).toThrow("Unsupported vault schema");
  });

  test("the v7 upgrade commits durably and survives a restart mid-write", async () => {
    const backend = createMemoryStore();
    const primary = createEncryptedStore(backend, VAULT_STORE_KEY);
    const staging = createEncryptedStore(backend, VAULT_MIGRATION_STORE_KEY);
    await primary.write(v7, vaultPassphrase);

    const unwritable = {
      ...primary,
      async write() {
        throw new Error("injected primary write failure");
      },
    };
    await expect(
      readMigratedVault({ primary: unwritable, staging }, vaultPassphrase),
    ).rejects.toThrow("injected primary write failure");

    // The stage holds the verified v8 result; the primary is still the v7 source.
    expect(isVaultV8(await staging.read(vaultPassphrase))).toBe(true);
    expect(await primary.read(vaultPassphrase)).toMatchObject({ schemaVersion: 7 });

    const recovered = await readMigratedVault({ primary, staging }, vaultPassphrase);
    expect(recovered.schemaVersion).toBe(8);
    expect(await staging.exists()).toBe(false);
    expect(await readMigratedVault({ primary, staging }, vaultPassphrase)).toEqual(recovered);
  });
});

describe("paired-phone address derivation", () => {
  // A KMS whose OpenZeppelin derivation throws, so any test that reaches it
  // fails loudly. Deriving an ML-DSA address from another family's recipe would
  // otherwise succeed and return a plausible address nobody holds the key for.
  // A stand-in for the real Poseidon commitment: not that value, but a
  // deterministic function of the whole key, which is what these assertions
  // depend on — same key, same address; different key, different address.
  const commitmentOf = (publicKey: string) =>
    `0x${(BigInt(publicKey.length) + BigInt(`0x${publicKey.slice(2, 34)}`)).toString(16)}`;

  const kms = {
    deriveOzAccountAddress: async () => {
      throw new Error("the OpenZeppelin derivation was reached for an ml-dsa account");
    },
    mlDsaKeyCommitment: async (publicKey: string) => commitmentOf(publicKey),
  } as never;

  const derive = (extra: Record<string, unknown>) => {
    const publicKey = extra["publicKey"];
    return deriveAccountContractAddress(kms, {
      accountContractType: "ml-dsa",
      networkId: "SN_MAIN",
      // The identity felt is the commitment, so the two agree here the way they
      // do on a real record. The refusal when they disagree is asserted below.
      publicKeyX: typeof publicKey === "string" ? commitmentOf(publicKey) : "0x456",
      ...extra,
    });
  };

  test("derives from the class hash and the expanded public key", async () => {
    const { address, classHash } = await derive({
      classHash: "0xabc",
      publicKey: mobileAccount.publicKey,
    });
    expect(classHash).toBe("0xabc");
    expect(canonicalFelt(address)).toBe(address);
    expect(isNonZeroStarkFieldElement(address)).toBe(true);
    expect((await derive({ classHash: "0xabc", publicKey: mobileAccount.publicKey })).address).toBe(
      address,
    );
    // The class hash and the key are the whole preimage: the commitment the
    // constructor takes is derived from the key rather than supplied beside it,
    // so there is no third input that could disagree with either.
    expect(
      (await derive({ classHash: "0xabc", publicKey: `0x${"cd".repeat(1952)}` })).address,
    ).not.toBe(address);
    expect(
      (await derive({ classHash: "0xdef", publicKey: mobileAccount.publicKey })).address,
    ).not.toBe(address);
  });

  test("refuses a record whose identity felt is not the commitment to its key", async () => {
    // Deployment calldata reads `publicKeyX` while signing reads `publicKey`. A
    // record where they disagree would deploy an account the device cannot sign
    // for, and the contract rejects every later transaction with no useful
    // error — so the mismatch is refused here, where both values are in hand.
    await expect(
      deriveAccountContractAddress(kms, {
        accountContractType: "ml-dsa",
        classHash: "0xabc",
        networkId: "SN_MAIN",
        publicKey: mobileAccount.publicKey,
        publicKeyX: "0x456",
      }),
    ).rejects.toThrow("ML-DSA account key does not match its stored identity");
  });

  test("an explicit class hash and public key are both required", async () => {
    await expect(derive({ publicKey: mobileAccount.publicKey })).rejects.toThrow(
      "ML-DSA account class hash is required",
    );
    await expect(derive({ classHash: "0xabc" })).rejects.toThrow(
      "ML-DSA account public key is required",
    );
  });
});
