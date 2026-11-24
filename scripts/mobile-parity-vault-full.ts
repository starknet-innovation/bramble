/**
 * G7b (wallet-core P7): the vault with every collection filled, written by the extension's own
 * vault service over the real Krusty package, at schema 13 (`vault-v13-full.json`) and at schema
 * 14 (`vault-v14.json`), plus the 13→14 migration (`vault-v13-to-v14.json`): the v13 vault sealed
 * by the extension's encrypted store, and what the service's unlock migrates it to and writes back.
 *
 * The wallet, in write order, on the published parity phrase:
 * - recovery: OpenZeppelin index 0, Braavos index 1 and a Ready (`argentx-bip44`) Argent on
 *   Mainnet (no provenance: a restore records none);
 * - created: OpenZeppelin index 1 on Mainnet and index 0 on devnet (`SN_DEVNET`);
 * - imported: a raw key (the phrase's OpenZeppelin key at index 7) and an imported phrase with
 *   OpenZeppelin index 0 on Mainnet (`importedSeeds`, its account's `seedId` binding);
 * - a Ledger record on Mainnet (no provenance; its public key is the phrase's OpenZeppelin
 *   public key at index 9) holding a Ledger viewing key for the Mainnet pool (`accountSecrets`);
 * - an origin grant, a shadow-account scope for the Mainnet pool, and one multisig's viewing key
 *   with a conflict mark from a co-owner's different key.
 *
 * The imported phrase must differ from the wallet's own, so it is the BIP-39 reference vector
 * (`legal winner thank year …`, also Krusty's adapter check). Every other key is the parity
 * phrase's own OpenZeppelin key at an index nothing else uses (7, 10, 12, 13), derived at run time;
 * no value in these fixtures is a secret. Keep-or-reseal as in `mobile-parity-vault.ts`.
 */

import {
  STRK20_MAINNET_POOL,
  STRK20_MAINNET_SHADOW_ACCOUNT_ANONYMIZER,
} from "@bramble/privacy/config";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { BRAAVOS_DEPLOYMENT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { PARITY_MNEMONIC } from "./mobile-parity";
import {
  asV13,
  parityFor,
  phraseAccount,
  sealPayload,
  VAULT_PARITY_PASSWORD,
  type VaultParity,
  vaultService,
  writtenPayload,
} from "./mobile-parity-vault";

/** Repository-relative paths of the G7b fixtures. */
export const VAULT_FULL_FIXTURE_PATHS = {
  migration: "mobile/core/tests/fixtures/vault-v13-to-v14.json",
  v13: "mobile/core/tests/fixtures/vault-v13-full.json",
  v14: "mobile/core/tests/fixtures/vault-v14.json",
} as const;

/** BIP-39's published reference phrase, imported as the wallet's second phrase. */
const IMPORTED_PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
/** A Mainnet multisig (the multisig parity fixtures' account) whose viewing key the wallet holds. */
const MULTISIG_ID = "SN_MAIN:0x28417e292e102205acc710013171cc42ff60afde90193b1c57977fdec5501c0";
const ORIGIN = "https://app.example";

const vaultPassphrase = VAULT_PARITY_PASSWORD;
const pool = { chainId: STARKNET_NETWORKS.SN_MAIN.chainId, poolAddress: STRK20_MAINNET_POOL };
const always = () => true;

/** Builds the full wallet through the extension's service and returns the store it wrote. */
const writeFullVault = async (): Promise<KeyValueStore> => {
  const store = createMemoryStore();
  const service = await vaultService(store);
  const [ozZero] = await service.recoverAccounts({
    mnemonic: PARITY_MNEMONIC,
    networkId: "SN_MAIN",
    selections: [
      { accountContractType: "openzeppelin", accountIndex: 0 },
      { accountContractType: "braavos", accountIndex: 1, classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH },
      { accountContractType: "argent", accountIndex: 0, derivation: "argentx-bip44" },
    ],
    vaultPassphrase,
  });
  if (!ozZero) throw new Error("recovery restored no account");
  for (const networkId of ["SN_MAIN", "SN_DEVNET"] as const) {
    await service.addDerivedAccount({
      accountContractType: "openzeppelin",
      networkId,
      vaultPassphrase,
    });
  }
  await service.importRawKeyAccount({
    accountContractType: "openzeppelin",
    networkId: "SN_MAIN",
    privateKey: (await phraseAccount(7)).privateKey,
    vaultPassphrase,
  });
  await service.importSeedAccounts({
    mnemonic: IMPORTED_PHRASE,
    networkId: "SN_MAIN",
    selections: [{ accountContractType: "openzeppelin", accountIndex: 0 }],
    vaultPassphrase,
  });
  const ledger = await service.addLedgerAccount({
    accountContractType: "openzeppelin",
    accountIndex: 0,
    networkId: "SN_MAIN",
    publicKeyX: (await phraseAccount(9)).account.publicKeyX,
    vaultPassphrase,
  });
  await service.storeLedgerStrk20ViewingKey({
    ...pool,
    accountId: ledger.id,
    vaultPassphrase,
    viewingKey: (await phraseAccount(10)).privateKey,
  });
  await service.grantOrigin({ accountId: ozZero.id, origin: ORIGIN, vaultPassphrase });
  await service.recordShadowAccountScope({
    ...pool,
    accountId: ozZero.id,
    anonymizer: STRK20_MAINNET_SHADOW_ACCOUNT_ANONYMIZER,
    label: "parity",
    nonces: ["0x1", "0x2"],
    origin: ORIGIN,
    vaultPassphrase,
  });
  for (const index of [12, 13]) {
    // The first offer is stored; the co-owner's different key leaves a conflict mark.
    await service.acceptMultisigStrk20Key({
      ...pool,
      isAuthorized: always,
      key: (await phraseAccount(index)).privateKey,
      multisigId: MULTISIG_ID,
      vaultPassphrase,
    });
  }
  await service.setActiveAccount({ accountId: ozZero.id, vaultPassphrase });
  return store;
};

/** The full wallet as the service wrote it (schema 14). */
const fullPayload = async (): Promise<unknown> => writtenPayload(await writeFullVault());

/** `vault-v13-full.json`: the full wallet at schema 13. */
export const computeFullV13VaultParity = async (committedSealed?: unknown): Promise<VaultParity> =>
  parityFor(asV13(await fullPayload()), committedSealed);

/** `vault-v14.json`: the full wallet at schema 14, with its `accountProvenance`. */
export const computeV14VaultParity = async (committedSealed?: unknown): Promise<VaultParity> =>
  parityFor(await fullPayload(), committedSealed);

/** The 13→14 case: the v13 input, and the vault the extension's unlock migrates it to. */
export type VaultMigrationParity = {
  readonly input: VaultParity;
  readonly output: VaultParity;
};

/**
 * `vault-v13-to-v14.json`: the full v13 vault sealed into a store, opened by the extension's
 * service (which migrates and writes it back), and the payload it wrote.
 */
export const computeVaultMigrationParity = async (
  committed?: Partial<Record<keyof VaultMigrationParity, { readonly sealed?: unknown }>>,
): Promise<VaultMigrationParity> => {
  const input = await parityFor(asV13(await fullPayload()), committed?.input?.sealed);
  const store = createMemoryStore();
  await sealPayload(input.payload, store);
  const read = await (await vaultService(store)).readVault(vaultPassphrase);
  const migrated = await writtenPayload(store);
  if (JSON.stringify(read) !== JSON.stringify(migrated)) {
    throw new Error("the service did not write back the vault it migrated");
  }
  return { input, output: await parityFor(migrated, committed?.output?.sealed) };
};
