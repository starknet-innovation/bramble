/**
 * The vault the mobile Rust core adopts (wallet-core's vault switch): a schema-v13 vault written by
 * the extension's own vault service and encrypted store, over the real Krusty package, for the
 * published E2E phrase. Every record, id, canonical felt and signing key is what a user's vault
 * would hold; nothing is assembled by hand. The core ports v13's validators and must accept this
 * payload, and a vault it builds for the same phrase and accounts must equal it.
 *
 * Accounts, as an imported wallet gets them: recovery restores OpenZeppelin index 0, Braavos index
 * 1 and a Ready (`argentx-bip44`) Argent on Mainnet (Braavos is never created and Ready only
 * arrives by recovery); the creation path then adds OpenZeppelin index 1 and an Argent on this
 * wallet's own ladder on Mainnet, and OpenZeppelin index 0 on Sepolia.
 * `bun run mobile:parity` writes it; `bun run check` fails on drift. Every value is public.
 *
 * `vault-v13-imported.json` (wallet-core P3, private-key import) is a second vault from the same
 * service: recovery restores OpenZeppelin index 0 on Mainnet from the phrase, then
 * `importRawKeyAccount` adds one OpenZeppelin and one Argent account from raw keys (derivation
 * `imported-raw-key`, the key in `signingKeys`, the Argent one active). The pasted keys are the
 * phrase's own OpenZeppelin keys at indexes 7 and 8, derived by the extension's `deriveAccount`:
 * no key outside the published phrase enters a fixture, and nothing at those indexes holds funds.
 * The imported accounts sit at their family's default class with no salt; an address-picked
 * (`address`) or multi-release (`classHashes`) import is left out (mobile imports neither).
 *
 * Both stay at schema 13, which wallet-core still reads. The service now writes schema 14, which is
 * v13 plus an optional `accountProvenance` map (the 13→14 migration adds nothing else), so the v13
 * payload is the service's v14 without that map and at version 13. `isVaultV13` must accept it and
 * the extension's own encrypted store seals it. This holds only while 13→14 is a version bump
 * (`packages/platform/vault/src/schema/migrations.ts`, the `fromVersion: 13` step); if that step
 * ever reshapes the vault, `asV13` must stop deriving v13 from a v14 payload.
 */

import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { deriveAccount } from "@bramble/vault/accounts";
import {
  createEncryptedStore,
  decryptJson,
  type EncryptedStore,
  isEncryptedEnvelope,
} from "@bramble/vault/encrypted-store";
import { isVaultV13 } from "@bramble/vault/schema";
import { createWalletVaultService } from "@bramble/vault/service";
import { VAULT_MIGRATION_STORE_KEY, VAULT_STORE_KEY } from "@bramble/vault/store-migration";
import { BRAAVOS_DEPLOYMENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { PARITY_MNEMONIC, sealedIsCurrent } from "./mobile-parity";

/** Repository-relative path of the committed fixture the Rust tests read. */
export const VAULT_PARITY_FIXTURE_PATH = "mobile/core/tests/fixtures/vault-v13.json";

/** The vault passphrase the fixture is sealed under. */
export const VAULT_PARITY_PASSWORD = "parity vault passphrase";

/** The AES-GCM scope the extension's encrypted store binds its vault to. */
export const VAULT_PARITY_SCOPE = `bramble:encrypted-store:${VAULT_STORE_KEY}`;

const vaultPassphrase = VAULT_PARITY_PASSWORD;
const mnemonic = PARITY_MNEMONIC;

/** Repository-relative path of the imported-key vault fixture (wallet-core P3). */
export const VAULT_IMPORTED_FIXTURE_PATH = "mobile/core/tests/fixtures/vault-v13-imported.json";

const kmsFor = async () => createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));

/** The extension's vault service over `store` (a fresh memory store for each fixture). */
export const vaultService = async (store: KeyValueStore) =>
  createWalletVaultService({
    encryptedStore: createEncryptedStore(store, VAULT_STORE_KEY),
    kms: await kmsFor(),
    migrationStore: createEncryptedStore(createMemoryStore(), VAULT_MIGRATION_STORE_KEY),
  });

/** Builds the vault through the extension's service and returns the store it wrote. */
const writeParityVault = async (): Promise<KeyValueStore> => {
  const store = createMemoryStore();
  const service = await vaultService(store);
  // Recovery only writes into an empty vault (it is the import path), so it goes first.
  await service.recoverAccounts({
    mnemonic,
    networkId: "SN_MAIN",
    selections: [
      { accountContractType: "openzeppelin", accountIndex: 0 },
      // Index 1, so the record shows Braavos walking the address axis, not the account axis.
      {
        accountContractType: "braavos",
        accountIndex: 1,
        classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
      },
      { accountContractType: "argent", accountIndex: 0, derivation: "argentx-bip44" },
    ],
    vaultPassphrase,
  });
  const second = await service.addDerivedAccount({
    accountContractType: "openzeppelin",
    networkId: "SN_MAIN",
    vaultPassphrase,
  });
  await service.addDerivedAccount({
    accountContractType: "argent",
    networkId: "SN_MAIN",
    vaultPassphrase,
  });
  await service.addDerivedAccount({
    accountContractType: "openzeppelin",
    networkId: "SN_SEPOLIA",
    vaultPassphrase,
  });
  await service.setActiveAccount({ accountId: second.id, vaultPassphrase });
  return store;
};

/** The phrase's OpenZeppelin account at `accountIndex`, as the extension derives it. */
export const phraseAccount = async (accountIndex: number) =>
  deriveAccount(await kmsFor(), {
    accountContractType: "openzeppelin",
    accountIndex,
    mnemonic,
    networkId: "SN_MAIN",
  });

const phraseKey = async (accountIndex: number): Promise<string> =>
  (await phraseAccount(accountIndex)).privateKey;

/** A phrase wallet with OpenZeppelin index 0, then two raw-key imports, through the service. */
const writeImportedVault = async (): Promise<KeyValueStore> => {
  const store = createMemoryStore();
  const service = await vaultService(store);
  await service.recoverAccounts({
    mnemonic,
    networkId: "SN_MAIN",
    selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
    vaultPassphrase,
  });
  for (const [accountContractType, index] of [
    ["openzeppelin", 7],
    ["argent", 8],
  ] as const) {
    await service.importRawKeyAccount({
      accountContractType,
      networkId: "SN_MAIN",
      privateKey: await phraseKey(index),
      vaultPassphrase,
    });
  }
  return store;
};

/** What the fixture holds: the inputs, the decrypted payload, and the envelope it was sealed in. */
export type VaultParity = {
  readonly mnemonic: string;
  readonly password: string;
  readonly payload: unknown;
  readonly scope: string;
  readonly sealed: unknown;
};

/** The schema-13 vault a v14 payload came from: no `accountProvenance`, key order kept. */
export const asV13 = (payload: unknown): unknown => {
  const v13 = Object.fromEntries(
    Object.entries(payload as Record<string, unknown>)
      .filter(([key]) => key !== "accountProvenance")
      .map(([key, value]) => [key, key === "schemaVersion" ? 13 : value]),
  );
  if (!isVaultV13(v13)) throw new Error("the v14 vault does not reduce to a valid v13 vault");
  return v13;
};

/** Seals `payload` into `store` with the extension's own encrypted store, as the service does. */
export const sealPayload = async (
  payload: unknown,
  store: KeyValueStore = createMemoryStore(),
): Promise<unknown> => {
  await createEncryptedStore(store, VAULT_STORE_KEY).write(
    payload as Parameters<EncryptedStore["write"]>[0],
    vaultPassphrase,
  );
  return store.get(VAULT_STORE_KEY);
};

/** The decrypted payload the service sealed into `store`. */
export const writtenPayload = async (store: KeyValueStore): Promise<unknown> => {
  const sealed = await store.get(VAULT_STORE_KEY);
  if (!isEncryptedEnvelope(sealed)) throw new Error("the vault service wrote no envelope");
  return decryptJson(sealed, vaultPassphrase, VAULT_PARITY_SCOPE);
};

/**
 * The fixture for `payload`, keeping `committedSealed` when the extension still opens it to that
 * same payload (a fresh seal draws a new salt, IV, lineage and commit, so re-sealing every run
 * would churn the fixture with no change in meaning).
 */
export const parityFor = async (
  payload: unknown,
  committedSealed: unknown,
): Promise<VaultParity> => {
  const keep = await sealedIsCurrent(committedSealed, payload, vaultPassphrase, VAULT_PARITY_SCOPE);
  return {
    mnemonic,
    password: vaultPassphrase,
    payload,
    scope: VAULT_PARITY_SCOPE,
    sealed: keep ? committedSealed : await sealPayload(payload),
  };
};

const v13ParityOf = async (
  written: Promise<KeyValueStore>,
  committedSealed: unknown,
): Promise<VaultParity> => parityFor(asV13(await writtenPayload(await written)), committedSealed);

/** Writes the vault afresh and returns it at schema 13 (see {@link parityFor} for the seal). */
export const computeVaultParity = (committedSealed?: unknown): Promise<VaultParity> =>
  v13ParityOf(writeParityVault(), committedSealed);

/** {@link computeVaultParity} for the imported-key vault (`vault-v13-imported.json`). */
export const computeImportedVaultParity = (committedSealed?: unknown): Promise<VaultParity> =>
  v13ParityOf(writeImportedVault(), committedSealed);
