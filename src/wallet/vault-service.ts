/**
 * Wallet vault service: privileged account metadata persistence behind encryption.
 */
import type { KrustyKms } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { isWalletOrigin } from "../shared/origin";
import { canonicalFelt, isStarkFieldElement, isStarkPrivateKey } from "../starknet/networks";
import { type EncryptedStore, isVaultPassphrase } from "../storage/encrypted-store";
import { assertStoreAccess, type StoreActor } from "../storage/permissioned-store";
import {
  LEDGER_STRK20_VIEWING_KEY_SCHEME,
  ledgerStrk20ScopeFor,
  ledgerStrk20ViewingKeyFor,
  withLedgerStrk20ViewingKey,
  withoutLedgerStrk20ViewingKey,
} from "../storage/vault-account-secrets";
import {
  CURRENT_SCHEMA_VERSION,
  isAccountId,
  isKeylessAccount,
  isVaultV4,
  type Vault,
} from "../storage/vault-schema";
import { readMigratedVault } from "../storage/vault-store-migration";
import {
  deriveAccount,
  deriveAccountRef,
  deriveImportedAccount,
  deriveLedgerAccount,
  deriveLedgerAccountRefs,
  nextAccountIndex,
} from "./accounts";
import { connectedSitesFromVault, grantedAccountIdsFor } from "./origin-grants";
import { deriveVaultStrk20ViewingKey, ledgerStrk20ViewingKeyCeremony } from "./strk20-viewing-key";
import { findVaultAccount } from "./vault-account";
import {
  deriveNetworkAccount,
  findNetworkAccount,
  selectSourceAccount,
} from "./vault-network-account";
import type { WalletVaultService } from "./vault-service-types";

export { activeAccountSecrets } from "./vault-reveal";

/**
 * Re-exports the documented type surface from its size-budget split.
 */
export type {
  AddDerivedAccountInput,
  AddLedgerAccountInput,
  ConnectedSite,
  CreateLedgerVaultInput,
  CreateVaultAccountInput,
  DeriveLedgerAccountsInput,
  DeriveLedgerStrk20ViewingKeyInput,
  EnsureNetworkAccountInput,
  ForgetLedgerStrk20ViewingKeyInput,
  ImportRawKeyAccountInput,
  OriginGrantInput,
  RevealedSecrets,
  RevokeOriginInput,
  SetActiveAccountInput,
  SignHashInput,
  StoreLedgerStrk20ViewingKeyInput,
  WalletStatus,
  WalletVaultService,
} from "./vault-service-types";

/**
 * Browser storage key for the encrypted wallet vault.
 */
export const VAULT_STORE_KEY = "mc-wallet:vault";

type WalletVaultServiceOptions = {
  readonly actor?: StoreActor;
  readonly encryptedStore: EncryptedStore;
  readonly kms: KrustyKms;
  readonly migrationStore: EncryptedStore;
};

const writeVault = async (
  encryptedStore: EncryptedStore,
  vault: Vault,
  vaultPassphrase: string,
): Promise<void> => {
  if (!isVaultV4(vault)) {
    throw new WalletError("Invalid vault");
  }
  await encryptedStore.write(vault, vaultPassphrase);
};

/**
 * Creates the background-only wallet service over encrypted storage and KMS.
 */
export const createWalletVaultService = ({
  actor = "background",
  encryptedStore,
  kms,
  migrationStore,
}: WalletVaultServiceOptions): WalletVaultService => {
  assertStoreAccess("vault", actor);

  const readVaultSnapshot = async (vaultPassphrase: string): Promise<Vault> => {
    if (!isVaultPassphrase(vaultPassphrase)) {
      throw new WalletError("Passphrase must be at least 12 characters");
    }
    return readMigratedVault({ primary: encryptedStore, staging: migrationStore }, vaultPassphrase);
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

  const readVault = (vaultPassphrase: string): Promise<Vault> =>
    serialized(async () => {
      const vault = await readVaultSnapshot(vaultPassphrase);
      await encryptedStore.upgradeLegacyEnvelope(vaultPassphrase).catch(() => undefined);
      return vault;
    });

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
          ...vault,
          accounts: [...vault.accounts, account],
          activeAccountId: vault.activeAccountId ?? account.id,
          mnemonic: vault.mnemonic ?? input.mnemonic,
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
          accountSecrets: [],
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
    async deriveLedgerStrk20ViewingKey(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const next = await ledgerStrk20ViewingKeyCeremony(kms, vault, input);
      await writeVault(encryptedStore, next, input.vaultPassphrase);
    },
    async deriveStrk20ViewingKey(input) {
      const vault = await readVault(input.vaultPassphrase);
      return deriveVaultStrk20ViewingKey(
        kms,
        vault,
        input.accountId,
        input.chainId,
        input.poolAddress,
      );
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
    async forgetLedgerStrk20ViewingKey(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const account = findVaultAccount(vault, input.accountId);
      if (!isKeylessAccount(account)) {
        throw new WalletError("Account is not a Ledger account");
      }
      const scope = ledgerStrk20ScopeFor(account, input.chainId, input.poolAddress);
      if (!scope) {
        throw new WalletError("Invalid Ledger STRK20 viewing-key scope");
      }
      const existing = ledgerStrk20ViewingKeyFor(
        vault.accountSecrets,
        account.id,
        scope.chainId,
        scope.poolAddress,
      );
      if (!existing) {
        return false;
      }
      await writeVault(
        encryptedStore,
        {
          ...vault,
          accountSecrets: withoutLedgerStrk20ViewingKey(
            vault.accountSecrets,
            account.id,
            scope.chainId,
            scope.poolAddress,
          ),
        },
        input.vaultPassphrase,
      );
      return true;
    },
    generateMnemonic() {
      return kms.generateMnemonic();
    },
    previewAccount: (input) => deriveAccountRef(kms, input),
    async grantOrigin(input) {
      if (!isWalletOrigin(input.origin)) {
        throw new WalletError("Invalid origin");
      }

      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const accountId = input.accountId ?? vault.activeAccountId;
      if (!accountId) {
        throw new WalletError("No account selected");
      }

      const account = findVaultAccount(vault, accountId);
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
      return grantedAccountIdsFor(vault, origin).map((accountId) =>
        findVaultAccount(vault, accountId),
      );
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
      const account = findVaultAccount(vault, input.accountId);

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
    async storeLedgerStrk20ViewingKey(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const account = findVaultAccount(vault, input.accountId);
      if (!isKeylessAccount(account)) {
        throw new WalletError("Account is not a Ledger account");
      }
      const scope = ledgerStrk20ScopeFor(account, input.chainId, input.poolAddress);
      const viewingKey = canonicalFelt(input.viewingKey);
      if (!scope || !viewingKey || !isStarkPrivateKey(viewingKey)) {
        throw new WalletError("Invalid Ledger STRK20 viewing key");
      }
      const accountSecrets = withLedgerStrk20ViewingKey(vault.accountSecrets, {
        accountId: account.id,
        ledgerStrk20ViewingKeys: [
          { ...scope, scheme: LEDGER_STRK20_VIEWING_KEY_SCHEME, viewingKey },
        ],
      });
      if (!accountSecrets) {
        throw new WalletError("Ledger STRK20 viewing-key limit reached");
      }
      await writeVault(encryptedStore, { ...vault, accountSecrets }, input.vaultPassphrase);
    },
  };

  return {
    ...service,
    addDerivedAccount: (input) => serialized(() => service.addDerivedAccount(input)),
    addLedgerAccount: (input) => serialized(() => service.addLedgerAccount(input)),
    createAccount: (input) => serialized(() => service.createAccount(input)),
    createLedgerVault: (input) => serialized(() => service.createLedgerVault(input)),
    deriveLedgerStrk20ViewingKey: (input) =>
      serialized(() => service.deriveLedgerStrk20ViewingKey(input)),
    ensureNetworkAccount: (input) => serialized(() => service.ensureNetworkAccount(input)),
    forgetLedgerStrk20ViewingKey: (input) =>
      serialized(() => service.forgetLedgerStrk20ViewingKey(input)),
    importRawKeyAccount: (input) => serialized(() => service.importRawKeyAccount(input)),
    grantOrigin: (input) => serialized(() => service.grantOrigin(input)),
    revokeOrigin: (input) => serialized(() => service.revokeOrigin(input)),
    setActiveAccount: (input) => serialized(() => service.setActiveAccount(input)),
    storeLedgerStrk20ViewingKey: (input) =>
      serialized(() => service.storeLedgerStrk20ViewingKey(input)),
  };
};
