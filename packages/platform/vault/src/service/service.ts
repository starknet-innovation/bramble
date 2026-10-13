/** Wallet vault service: privileged account metadata persistence behind encryption. */
import { invariant, WalletError } from "@bramble/core/errors";
import { isWalletOrigin } from "@bramble/core/origin";
import { assertStoreAccess, type StoreActor } from "@bramble/store/access";
import { isAccountId, isKeylessAccount } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isStarkFieldElement,
  isStarkPrivateKey,
} from "@bramble/wallet-model/networks";
import { isVaultPassphrase, MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import {
  LEDGER_STRK20_VIEWING_KEY_SCHEME,
  ledgerStrk20ScopeFor,
  ledgerStrk20ViewingKeyFor,
  withLedgerStrk20ViewingKey,
  withoutLedgerStrk20ViewingKey,
} from "../accounts/account-secrets";
import { deriveAccountRef } from "../accounts/accounts";
import {
  deriveNetworkAccount,
  findNetworkAccount,
  selectSourceAccount,
} from "../accounts/network-account";
import { deriveVaultStrk20ViewingKey } from "../accounts/strk20-viewing-key";
import { findVaultAccount } from "../accounts/vault-account";
import type { EncryptedStore } from "../encrypted-store";
import type { KmsPort } from "../kms-port";
import { migrateVault } from "../schema/migrations";
import { isVaultV12, type Vault } from "../schema/schema";
import { readMigratedVault } from "../schema/store-migration";
import { requireGrantAuthorization, rollbackRevokedGrant } from "./grant-authorization";
import { createGrantCache } from "./grant-cache";
import { nostrWalletMethods } from "./nostr";
import { connectedSitesFromVault, grantedAccountIdsFor } from "./origin-grants";
import { importSeedVaultAccounts, recoverVaultAccounts } from "./recovery";
import { vaultCreationMethods, writeVault } from "./service-creation";
import type { VaultRecovery, WalletVaultService } from "./service-types";
import { shadowAccountScopeMethods } from "./shadow-account-scopes";

export { activeAccountSecrets } from "./reveal";
/** Re-exports the documented type surface from its size-budget split. */
export type {
  AddDerivedAccountInput,
  AddLedgerAccountInput,
  ConnectedSite,
  CreateKeyVaultInput,
  CreateLedgerVaultInput,
  CreateVaultAccountInput,
  DeriveLedgerAccountsInput,
  EnsureNetworkAccountInput,
  ForgetLedgerStrk20ViewingKeyInput,
  ImportRawKeyAccountInput,
  ListShadowAccountScopesInput,
  OpenNostrApplicationDataBatchInput,
  OpenNostrApplicationDataInput,
  OriginGrantInput,
  RecordShadowAccountScopeInput,
  RecoverVaultAccountsInput,
  RevealedSecrets,
  RevokeOriginInput,
  SetActiveAccountInput,
  SignHashInput,
  StoreLedgerStrk20ViewingKeyInput,
  VaultRecovery,
  WalletStatus,
  WalletVaultService,
  WrapNostrApplicationDataBatchInput,
  WrapNostrApplicationDataInput,
} from "./service-types";

type WalletVaultServiceOptions = {
  readonly actor?: StoreActor;
  readonly encryptedStore: EncryptedStore;
  readonly kms: KmsPort;
  readonly migrationStore: EncryptedStore;
};

/**
 * Creates the background-only wallet service over encrypted storage and KMS.
 */
export const createWalletVaultService = ({
  actor = "background",
  encryptedStore: primaryStore,
  kms,
  migrationStore,
}: WalletVaultServiceOptions): WalletVaultService => {
  assertStoreAccess("vault", actor);
  const grants = createGrantCache();
  const encryptedStore = grants.watch(primaryStore);
  const requirePassphrase = (vaultPassphrase: string): void => {
    if (!isVaultPassphrase(vaultPassphrase)) {
      throw new WalletError(
        `Passphrase must be at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters`,
      );
    }
  };
  const readVaultSnapshot = async (vaultPassphrase: string): Promise<Vault> => {
    requirePassphrase(vaultPassphrase);
    return readMigratedVault({ primary: encryptedStore, staging: migrationStore }, vaultPassphrase);
  };

  // Serialize read-modify-write mutations and legacy envelope upgrades.
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(run: () => Promise<T>): Promise<T> => {
    const next = mutationQueue.then(run, run);
    mutationQueue = next.catch(() => undefined);
    return next;
  };

  const readVault = (vaultPassphrase: string): Promise<Vault> =>
    serialized(async () => {
      // Not every write is serialized, so one that starts or ends during this
      // read leaves the cache empty rather than holding what it replaced.
      const startedAt = grants.generation();
      const vault = await readVaultSnapshot(vaultPassphrase);
      await encryptedStore.upgradeLegacyEnvelope(vaultPassphrase).catch(() => undefined);
      grants.remember(vaultPassphrase, vault, startedAt);
      return vault;
    });

  // Health reads may write (a session shadow, a mirror, the v2 marker), so they
  // queue behind mutations like any other vault access. An interrupted schema
  // migration can leave a staged copy that verifies, which a normal unlock
  // recovers from, so recovery is not offered while one exists. A storage
  // failure is not a recovery reason: status still answers, and the unlock
  // reports the failure.
  const vaultRecovery = (): Promise<VaultRecovery | undefined> =>
    serialized(async () => {
      try {
        const health = await encryptedStore.health();
        if (health === "absent" || health === "ok" || (await migrationStore.health()) === "ok") {
          return undefined;
        }
        return health;
      } catch {
        return undefined;
      }
    });

  const service: WalletVaultService = {
    ...vaultCreationMethods({ encryptedStore, kms, readVaultSnapshot }),
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

      // Missing projection key material fails closed in the helper.
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
    ...nostrWalletMethods(kms, readVault),
    ...shadowAccountScopeMethods(encryptedStore, readVaultSnapshot),
    previewAccount: (input) => deriveAccountRef(kms, input),
    validateMnemonic: (mnemonic) => kms.validateMnemonic(mnemonic),
    async grantOrigin(input) {
      if (!isWalletOrigin(input.origin)) {
        throw new WalletError("Invalid origin");
      }
      const isAuthorized = input.isAuthorized ?? (() => true);
      requireGrantAuthorization(isAuthorized);

      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const accountId = input.accountId ?? vault.activeAccountId;
      if (!accountId) {
        throw new WalletError("No account selected");
      }

      const account = findVaultAccount(vault, accountId);
      const grants = vault.originGrants.filter((grant) => grant.origin !== input.origin);
      const existing = vault.originGrants.find((grant) => grant.origin === input.origin);
      const accountIds = [...new Set([...(existing?.accountIds ?? []), account.id])];
      requireGrantAuthorization(isAuthorized);

      // Re-checked after encryption, right before the commit starts: a
      // lock during key derivation abandons the grant with nothing stored. The
      // rollback covers only a lock during the storage writes themselves
      // (Sherlock 255).
      await writeVault(
        encryptedStore,
        {
          ...vault,
          originGrants: [...grants, { accountIds, origin: input.origin }],
        },
        input.vaultPassphrase,
        () => requireGrantAuthorization(isAuthorized),
      );
      await rollbackRevokedGrant(isAuthorized, () =>
        writeVault(encryptedStore, vault, input.vaultPassphrase),
      );

      return [account];
    },
    async getGrantedAccounts(origin, vaultPassphrase) {
      if (!isWalletOrigin(origin)) {
        throw new WalletError("Invalid origin");
      }

      // Served from memory between writes, so a site cannot time this read
      // to learn whether the wallet is unlocked (Sherlock 135).
      const vault = grants.lookup(vaultPassphrase) ?? (await readVault(vaultPassphrase));
      return grantedAccountIdsFor(vault, origin).map((accountId) =>
        findVaultAccount(vault, accountId),
      );
    },
    clearGrantCache: grants.clear,
    readVault,
    importSeedAccounts: (input) =>
      serialized(() => importSeedVaultAccounts(encryptedStore, kms, readVaultSnapshot, input)),
    recoverAccounts: (input) =>
      serialized(() => recoverVaultAccounts(encryptedStore, kms, readVaultSnapshot, input)),
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
    recoverUnverifiedVault: (vaultPassphrase) =>
      serialized(async () => {
        requirePassphrase(vaultPassphrase);
        const vault = migrateVault(await encryptedStore.readUnverified(vaultPassphrase));
        invariant(isVaultV12(vault), "Unsupported vault schema");
        // A rollback can restore a revoked site connection or a removed Ledger
        // viewing key; the user cannot tell which, so recovery drops them all.
        await encryptedStore.replaceUnverified(
          { ...vault, accountSecrets: [], originGrants: [] },
          vaultPassphrase,
        );
      }),
    async status() {
      const hasVault = await encryptedStore.exists();
      const recovery = hasVault ? await vaultRecovery() : undefined;
      return {
        accountCount: 0,
        activeAccountId: null,
        hasVault,
        locked: hasVault,
        ready: true,
        ...(recovery ? { recovery } : {}),
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
    createKeyVault: (input) => serialized(() => service.createKeyVault(input)),
    createLedgerVault: (input) => serialized(() => service.createLedgerVault(input)),
    ensureNetworkAccount: (input) => serialized(() => service.ensureNetworkAccount(input)),
    forgetLedgerStrk20ViewingKey: (input) =>
      serialized(() => service.forgetLedgerStrk20ViewingKey(input)),
    importRawKeyAccount: (input) => serialized(() => service.importRawKeyAccount(input)),
    grantOrigin: (input) => serialized(() => service.grantOrigin(input)),
    revokeOrigin: (input) => serialized(() => service.revokeOrigin(input)),
    recordShadowAccountScope: (input) => serialized(() => service.recordShadowAccountScope(input)),
    setActiveAccount: (input) => serialized(() => service.setActiveAccount(input)),
    storeLedgerStrk20ViewingKey: (input) =>
      serialized(() => service.storeLedgerStrk20ViewingKey(input)),
  };
};
