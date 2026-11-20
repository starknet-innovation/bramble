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
 */

import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import {
  createEncryptedStore,
  decryptJson,
  isEncryptedEnvelope,
} from "@bramble/vault/encrypted-store";
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

/** Builds the vault through the extension's service and returns the store it wrote. */
const writeParityVault = async (): Promise<KeyValueStore> => {
  const store = createMemoryStore();
  const service = createWalletVaultService({
    encryptedStore: createEncryptedStore(store, VAULT_STORE_KEY),
    kms: createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm")),
    migrationStore: createEncryptedStore(createMemoryStore(), VAULT_MIGRATION_STORE_KEY),
  });
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

/** What the fixture holds: the inputs, the decrypted payload, and the envelope it was sealed in. */
export type VaultParity = {
  readonly mnemonic: string;
  readonly password: string;
  readonly payload: unknown;
  readonly scope: string;
  readonly sealed: unknown;
};

/**
 * Writes the vault afresh and returns its payload, keeping `committedSealed` when the extension
 * still opens it to that same payload (a fresh seal draws a new salt, IV, lineage and commit, so
 * re-sealing every run would churn the fixture with no change in meaning).
 */
export const computeVaultParity = async (committedSealed?: unknown): Promise<VaultParity> => {
  const sealed = await (await writeParityVault()).get(VAULT_STORE_KEY);
  if (!isEncryptedEnvelope(sealed)) throw new Error("the vault service wrote no envelope");
  const payload = await decryptJson(sealed, vaultPassphrase, VAULT_PARITY_SCOPE);
  const keep = await sealedIsCurrent(committedSealed, payload, vaultPassphrase, VAULT_PARITY_SCOPE);
  return {
    mnemonic,
    password: vaultPassphrase,
    payload,
    scope: VAULT_PARITY_SCOPE,
    sealed: keep ? committedSealed : sealed,
  };
};
