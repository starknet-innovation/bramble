/**
 * Wallet vault service: privileged account metadata persistence behind encryption.
 */
import type { KrustyKms } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { isWalletOrigin } from "../shared/origin";
import {
  isNonZeroStarkFieldElement,
  isStarkFieldElement,
  type StarknetNetworkId,
} from "../starknet/networks";
import { type EncryptedStore, isVaultPassphrase } from "../storage/encrypted-store";
import { migrateVault } from "../storage/migrations";
import { assertStoreAccess, type StoreActor } from "../storage/permissioned-store";
import {
  type AccountRef,
  CURRENT_SCHEMA_VERSION,
  isAccountId,
  isKeylessAccount,
  type SigningKeyRef,
  type Vault,
} from "../storage/vault-schema";
import {
  deriveAccount,
  deriveImportedAccount,
  deriveLedgerAccount,
  deriveLedgerAccountRefs,
  getOzAccountClassHash,
  nextAccountIndex,
  sameWalletKey,
} from "./accounts";
import type { ConnectedSite, RevealedSecrets, WalletVaultService } from "./vault-service-types";

/**
 * Re-exports the vault-service type surface (split into `vault-service-types.ts`
 * for the file-size budget) so existing importers keep resolving these from the
 * service module. Trust boundary and failure behavior are documented on each
 * type at its definition.
 */
export type {
  AddDerivedAccountInput,
  AddLedgerAccountInput,
  ConnectedSite,
  CreateLedgerVaultInput,
  CreateVaultAccountInput,
  DeriveLedgerAccountsInput,
  EnsureNetworkAccountInput,
  ImportRawKeyAccountInput,
  OriginGrantInput,
  RevealedSecrets,
  RevokeOriginInput,
  SetActiveAccountInput,
  SignHashInput,
  WalletStatus,
  WalletVaultService,
} from "./vault-service-types";

/**
 * Browser storage key for the encrypted wallet vault.
 */
export const VAULT_STORE_KEY = "mc-wallet:vault";

/**
 * Derives the connected-sites list (origin plus granted account count) from a
 * decrypted vault, ordered by origin for stable rendering. Pure helper reused
 * by the connected-sites reader and by revocation responses.
 */
export const connectedSitesFromVault = (vault: Vault): readonly ConnectedSite[] =>
  vault.originGrants
    .map((grant) => ({ accountCount: grant.accountIds.length, origin: grant.origin }))
    .sort((left, right) => left.origin.localeCompare(right.origin));

type WalletVaultServiceOptions = {
  readonly actor?: StoreActor;
  readonly encryptedStore: EncryptedStore;
  readonly kms: KrustyKms;
};

const writeVault = async (
  encryptedStore: EncryptedStore,
  vault: Vault,
  vaultPassphrase: string,
): Promise<void> => {
  await encryptedStore.write(vault, vaultPassphrase);
};

const findAccount = (vault: Vault, accountId: string): AccountRef => {
  if (!isAccountId(accountId)) {
    throw new WalletError("Invalid account id");
  }

  const account = vault.accounts.find((stored) => stored.id === accountId);
  if (!account) {
    throw new WalletError("Account not found");
  }
  return account;
};

// The wallet key to derive from when adding a network account: active, else first.
const selectSourceAccount = (vault: Vault): AccountRef | undefined =>
  (vault.activeAccountId
    ? vault.accounts.find((stored) => stored.id === vault.activeAccountId)
    : null) ?? vault.accounts[0];
// The existing account deriving `source`'s key onto `networkId`, if any.
const findNetworkAccount = (
  vault: Vault,
  networkId: StarknetNetworkId,
  source: AccountRef,
): AccountRef | undefined =>
  vault.accounts.find((stored) => stored.networkId === networkId && sameWalletKey(stored, source));

// Derives `source`'s account onto `networkId`, returning the new `AccountRef`
// together with the signing-key entries the vault must gain for it. A keyless
// Ledger source stays keyless: it re-derives a Ledger account on the target
// network from its stored `publicKeyX` + device derivation metadata (reusing
// `deriveLedgerAccount`, which resolves the TARGET network's class hash and the
// counterfactual address the same way), and needs no signing key. Any keyed
// account clones its retained signing key onto the derived address, and fails
// closed ("Signing key unavailable") if that key is somehow absent.
const deriveNetworkAccount = async (
  kms: KrustyKms,
  vault: Vault,
  source: AccountRef,
  networkId: StarknetNetworkId,
): Promise<{ readonly account: AccountRef; readonly signingKeys: readonly SigningKeyRef[] }> => {
  if (isKeylessAccount(source)) {
    const account = await deriveLedgerAccount(kms, {
      accountIndex: source.derivation.accountIndex,
      eip2645application: source.derivation.eip2645application,
      networkId,
      publicKeyX: source.publicKeyX,
    });
    return { account, signingKeys: [] };
  }
  const signingKey = vault.signingKeys.find((stored) => stored.accountId === source.id);
  if (!signingKey) {
    throw new WalletError("Signing key unavailable");
  }
  const classHash = await getOzAccountClassHash(kms, networkId);
  const address = await kms.deriveOzAccountAddress(source.publicKeyX, classHash);
  if (!isNonZeroStarkFieldElement(address)) {
    throw new WalletError("Krusty KMS returned invalid account address");
  }
  const account: AccountRef = {
    ...source,
    address,
    classHash,
    id: `${networkId}:${address}`,
    networkId,
  };
  return { account, signingKeys: [{ accountId: account.id, privateKey: signingKey.privateKey }] };
};

/**
 * Extracts the active account's private key and the vault recovery phrase for
 * the re-authenticated reveal flow. Throws when no account is selected or its
 * signing key is missing; never persists or logs the returned material.
 */
export const activeAccountSecrets = (vault: Vault): RevealedSecrets => {
  const accountId = vault.activeAccountId;
  if (!accountId) {
    throw new WalletError("No account selected");
  }
  const signingKey = vault.signingKeys.find((key) => key.accountId === accountId);
  if (!signingKey) {
    throw new WalletError("Signing key unavailable");
  }
  return { mnemonic: vault.mnemonic, privateKey: signingKey.privateKey };
};

/**
 * Creates the background-only wallet service over encrypted storage and KMS.
 */
export const createWalletVaultService = ({
  actor = "background",
  encryptedStore,
  kms,
}: WalletVaultServiceOptions): WalletVaultService => {
  assertStoreAccess("vault", actor);

  const readVaultSnapshot = async (vaultPassphrase: string): Promise<Vault> => {
    if (!isVaultPassphrase(vaultPassphrase)) {
      throw new WalletError("Passphrase must be at least 12 characters");
    }
    return migrateVault(await encryptedStore.read(vaultPassphrase));
  };

  // Serializes vault mutations. Every mutation is a read-modify-write of the
  // encrypted store and the background dispatches messages concurrently, so
  // two interleaved mutations would silently lose one write (e.g. a grant
  // racing an account derivation). Legacy KDF upgrade writes also run here:
  // passive reads may trigger them, but they must never clobber a queued
  // mutation. Failures do not poison the queue.
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(run: () => Promise<T>): Promise<T> => {
    const next = mutationQueue.then(run, run);
    mutationQueue = next.catch(() => undefined);
    return next;
  };

  const readVault = async (vaultPassphrase: string): Promise<Vault> => {
    const vault = await readVaultSnapshot(vaultPassphrase);
    await serialized(() => encryptedStore.upgradeLegacyEnvelope(vaultPassphrase)).catch(
      () => undefined,
    );
    return vault;
  };

  const service: WalletVaultService = {
    async addDerivedAccount(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      if (!vault.mnemonic) {
        throw new WalletError("No recovery phrase stored for this wallet");
      }

      const { account, privateKey } = await deriveAccount(kms, {
        accountIndex: nextAccountIndex(vault.accounts, input.networkId),
        mnemonic: vault.mnemonic,
        networkId: input.networkId,
      });
      if (vault.accounts.some((stored) => stored.id === account.id)) {
        throw new WalletError("Account already exists");
      }

      await writeVault(
        encryptedStore,
        {
          ...vault,
          accounts: [...vault.accounts, account],
          activeAccountId: account.id,
          signingKeys: [...vault.signingKeys, { accountId: account.id, privateKey }],
        },
        input.vaultPassphrase,
      );

      return account;
    },
    async createAccount(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const { account, privateKey } = await deriveAccount(kms, input);

      if (vault.accounts.some((stored) => stored.id === account.id)) {
        throw new WalletError("Account already exists");
      }

      await writeVault(
        encryptedStore,
        {
          accounts: [...vault.accounts, account],
          activeAccountId: vault.activeAccountId ?? account.id,
          mnemonic: vault.mnemonic ?? input.mnemonic,
          originGrants: vault.originGrants,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          signingKeys: [...vault.signingKeys, { accountId: account.id, privateKey }],
        },
        input.vaultPassphrase,
      );

      return account;
    },
    async importRawKeyAccount(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const { account, privateKey } = await deriveImportedAccount(kms, {
        networkId: input.networkId,
        privateKey: input.privateKey,
      });
      if (vault.accounts.some((stored) => stored.id === account.id)) {
        throw new WalletError("Account already exists");
      }

      await writeVault(
        encryptedStore,
        {
          ...vault,
          accounts: [...vault.accounts, account],
          activeAccountId: account.id,
          signingKeys: [...vault.signingKeys, { accountId: account.id, privateKey }],
        },
        input.vaultPassphrase,
      );

      return account;
    },
    async addLedgerAccount(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const account = await deriveLedgerAccount(kms, {
        accountIndex: input.accountIndex,
        networkId: input.networkId,
        publicKeyX: input.publicKeyX,
        ...(input.eip2645application ? { eip2645application: input.eip2645application } : {}),
      });
      if (vault.accounts.some((stored) => stored.id === account.id)) {
        throw new WalletError("Account already exists");
      }

      // A Ledger account is keyless: it is added to `accounts` with no matching
      // `signingKeys` entry, which the relaxed vault bijection allows.
      await writeVault(
        encryptedStore,
        { ...vault, accounts: [...vault.accounts, account], activeAccountId: account.id },
        input.vaultPassphrase,
      );

      return account;
    },
    async createLedgerVault(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      // First-run only: a mnemonic-less Ledger vault is created over a fresh
      // store. Refuse if any account or a recovery phrase already exists so this
      // can never quietly drop an existing seeded wallet's key material.
      if (vault.accounts.length > 0 || vault.mnemonic !== null) {
        throw new WalletError("Wallet already exists");
      }
      const account = await deriveLedgerAccount(kms, {
        accountIndex: input.accountIndex,
        networkId: input.networkId,
        publicKeyX: input.publicKeyX,
        ...(input.eip2645application ? { eip2645application: input.eip2645application } : {}),
      });

      // The vault holds no seed and no signing key: the account is keyless, so
      // the mnemonic stays null and signingKeys stays empty. The relaxed
      // account↔signingKey bijection admits exactly this shape.
      await writeVault(
        encryptedStore,
        {
          accounts: [account],
          activeAccountId: account.id,
          mnemonic: null,
          originGrants: [],
          schemaVersion: CURRENT_SCHEMA_VERSION,
          signingKeys: [],
        },
        input.vaultPassphrase,
      );

      return account;
    },
    deriveLedgerAccounts(input) {
      return deriveLedgerAccountRefs(kms, { entries: input.entries, networkId: input.networkId });
    },
    async ensureNetworkAccount(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const source = selectSourceAccount(vault);
      if (!source) {
        throw new WalletError("No account selected");
      }
      const existing = findNetworkAccount(vault, input.networkId, source);
      if (existing) {
        await writeVault(
          encryptedStore,
          { ...vault, activeAccountId: existing.id },
          input.vaultPassphrase,
        );
        return existing;
      }

      // A keyless Ledger source derives a keyless Ledger account on the target
      // network (no signing key required); every keyed account clones its
      // retained key onto the derived address. Both fail closed inside the
      // helper if their required material is absent.
      const { account, signingKeys } = await deriveNetworkAccount(
        kms,
        vault,
        source,
        input.networkId,
      );
      if (vault.accounts.some((stored) => stored.id === account.id)) {
        throw new WalletError("Account already exists");
      }

      await writeVault(
        encryptedStore,
        {
          ...vault,
          accounts: [...vault.accounts, account],
          activeAccountId: account.id,
          signingKeys: [...vault.signingKeys, ...signingKeys],
        },
        input.vaultPassphrase,
      );
      return account;
    },
    generateMnemonic() {
      return kms.generateMnemonic();
    },
    async grantOrigin(input) {
      if (!isWalletOrigin(input.origin)) {
        throw new WalletError("Invalid origin");
      }

      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const accountId = input.accountId ?? vault.activeAccountId;
      if (!accountId) {
        throw new WalletError("No account selected");
      }

      const account = findAccount(vault, accountId);
      const grants = vault.originGrants.filter((grant) => grant.origin !== input.origin);
      const existing = vault.originGrants.find((grant) => grant.origin === input.origin);
      const accountIds = [...new Set([...(existing?.accountIds ?? []), account.id])];

      await writeVault(
        encryptedStore,
        {
          ...vault,
          originGrants: [...grants, { accountIds, origin: input.origin }],
        },
        input.vaultPassphrase,
      );

      return [account];
    },
    async getGrantedAccounts(origin, vaultPassphrase) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      const vault = await readVault(vaultPassphrase);
      const grant = vault.originGrants.find((stored) => stored.origin === origin);
      if (!grant) {
        return [];
      }
      return grant.accountIds.map((accountId) => findAccount(vault, accountId));
    },
    readVault,
    async revokeOrigin(input) {
      if (!isWalletOrigin(input.origin)) {
        throw new WalletError("Invalid origin");
      }

      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const originGrants = vault.originGrants.filter((grant) => grant.origin !== input.origin);
      if (originGrants.length !== vault.originGrants.length) {
        await writeVault(encryptedStore, { ...vault, originGrants }, input.vaultPassphrase);
      }
      return connectedSitesFromVault({ ...vault, originGrants });
    },
    async setActiveAccount(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const account = findAccount(vault, input.accountId);

      await writeVault(
        encryptedStore,
        {
          ...vault,
          activeAccountId: account.id,
        },
        input.vaultPassphrase,
      );

      return account;
    },
    async signHash(input) {
      if (!isStarkFieldElement(input.messageHash)) {
        throw new WalletError("Invalid message hash");
      }

      const vault = await readVault(input.vaultPassphrase);
      const accountId = input.accountId ?? vault.activeAccountId;
      if (!accountId) {
        throw new WalletError("No account selected");
      }
      if (!isAccountId(accountId)) {
        throw new WalletError("Invalid account id");
      }

      const signingKey = vault.signingKeys.find((key) => key.accountId === accountId);
      if (!signingKey) {
        throw new WalletError("Signing key unavailable");
      }

      return kms.signStarkHash(signingKey.privateKey, input.messageHash);
    },
    async status() {
      const hasVault = await encryptedStore.exists();
      return {
        accountCount: 0,
        activeAccountId: null,
        hasVault,
        locked: hasVault,
        ready: true,
      };
    },
  };

  return {
    ...service,
    addDerivedAccount: (input) => serialized(() => service.addDerivedAccount(input)),
    addLedgerAccount: (input) => serialized(() => service.addLedgerAccount(input)),
    createAccount: (input) => serialized(() => service.createAccount(input)),
    createLedgerVault: (input) => serialized(() => service.createLedgerVault(input)),
    ensureNetworkAccount: (input) => serialized(() => service.ensureNetworkAccount(input)),
    importRawKeyAccount: (input) => serialized(() => service.importRawKeyAccount(input)),
    grantOrigin: (input) => serialized(() => service.grantOrigin(input)),
    revokeOrigin: (input) => serialized(() => service.revokeOrigin(input)),
    setActiveAccount: (input) => serialized(() => service.setActiveAccount(input)),
  };
};
