/**
 * Wallet vault service: privileged account metadata persistence behind encryption.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { assertStoreAccess, type StoreActor } from "@mc-wallet/store/access";
import { isAccountId, isKeylessAccount } from "@mc-wallet/wallet-model/accounts";
import {
  canonicalFelt,
  isStarkFieldElement,
  isStarkPrivateKey,
} from "@mc-wallet/wallet-model/networks";
import { isVaultPassphrase } from "@mc-wallet/wallet-model/passphrase";
import {
  LEDGER_STRK20_VIEWING_KEY_SCHEME,
  ledgerStrk20ScopeFor,
  ledgerStrk20ViewingKeyFor,
  withLedgerStrk20ViewingKey,
  withoutLedgerStrk20ViewingKey,
} from "../accounts/account-secrets";
import {
  deriveAccount,
  deriveAccountRef,
  deriveImportedAccount,
  deriveLedgerAccount,
  deriveLedgerAccountRefs,
  nextAccountIndex,
} from "../accounts/accounts";
import {
  deriveNetworkAccount,
  findNetworkAccount,
  selectSourceAccount,
} from "../accounts/network-account";
import { scanSeedAccounts } from "../accounts/seed-account-scan";
import {
  deriveVaultStrk20ViewingKey,
  runLedgerStrk20ViewingKeyCeremony,
} from "../accounts/strk20-viewing-key";
import { findVaultAccount } from "../accounts/vault-account";
import type { EncryptedStore } from "../encrypted-store";
import type { KmsPort } from "../kms-port";
import { CURRENT_SCHEMA_VERSION, isVaultV4, type Vault } from "../schema/schema";
import { readMigratedVault } from "../schema/store-migration";
import { grantedAccountsFor, grantOriginAccess, revokeOriginAccess } from "./origin-ops";
import type { WalletVaultService } from "./service-types";

export { activeAccountSecrets } from "./reveal";

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
} from "./service-types";

type WalletVaultServiceOptions = {
  readonly actor?: StoreActor;
  readonly encryptedStore: EncryptedStore;
  readonly kms: KmsPort;
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

  // A vault-sourced scan needs the passphrase; the phrase-sourced form does not
  // carry one. Fail closed rather than handing `undefined` to the store.
  const requireVaultPassphrase = (vaultPassphrase: string | undefined): string => {
    if (vaultPassphrase === undefined) {
      throw new WalletError("Passphrase must be at least 12 characters");
    }
    return vaultPassphrase;
  };

  const originIo = {
    readVault,
    readVaultSnapshot,
    writeVault: (vault: Vault, vaultPassphrase: string) =>
      writeVault(encryptedStore, vault, vaultPassphrase),
  };

  const service: WalletVaultService = {
    async addDerivedAccount(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      if (!vault.mnemonic) {
        throw new WalletError("No recovery phrase stored for this wallet");
      }

      const { account, privateKey } = await deriveAccount(kms, {
        accountIndex: input.accountIndex ?? nextAccountIndex(vault.accounts, input.networkId),
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
    deriveLedgerStrk20ViewingKey: (input) =>
      runLedgerStrk20ViewingKeyCeremony(kms, input, {
        readVault: () => readVaultSnapshot(input.vaultPassphrase),
        serialized,
        writeVault: (vault) => writeVault(encryptedStore, vault, input.vaultPassphrase),
      }),
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
    // Either phrase source, resolved here so no caller outside this service ever
    // holds one: a recovery in progress supplies the phrase it is restoring, and
    // an existing wallet supplies its passphrase instead and the phrase is read
    // from the vault. The vault read completes before any probe runs, so the
    // mutation queue is never held across this walk's network round trips —
    // holding it would block every other vault operation for a whole scan.
    scanSeedAccounts: async (input) => {
      const mnemonic =
        input.mnemonic ?? (await readVault(requireVaultPassphrase(input.vaultPassphrase))).mnemonic;
      if (!mnemonic) {
        throw new WalletError("No recovery phrase stored for this wallet");
      }
      return scanSeedAccounts(kms, mnemonic, {
        networkId: input.networkId,
        probe: input.probe,
      });
    },
    grantOrigin: (input) => grantOriginAccess(originIo, input),
    getGrantedAccounts: (origin, vaultPassphrase) =>
      grantedAccountsFor(originIo, origin, vaultPassphrase),
    readVault,
    revokeOrigin: (input) => revokeOriginAccess(originIo, input),
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
