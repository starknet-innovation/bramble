/**
 * Wallet vault service: privileged account metadata persistence behind encryption.
 */
import type { KrustyKms, StarkSignature } from "../crypto/krusty";
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
  type Vault,
} from "../storage/vault-schema";
import { type AccountDerivationInput, deriveAccount, getOzAccountClassHash } from "./accounts";

/**
 * Browser storage key for the encrypted wallet vault.
 */
export const VAULT_STORE_KEY = "mc-wallet:vault";

/**
 * Public wallet status shown to popup and provider callers.
 */
export type WalletStatus = {
  readonly accountCount: number;
  readonly activeAccountId: string | null;
  readonly hasVault: boolean;
  readonly locked: boolean;
  readonly ready: boolean;
};

/**
 * Account creation input including the vault encryption passphrase.
 */
export type CreateVaultAccountInput = AccountDerivationInput & {
  readonly vaultPassphrase: string;
};

/**
 * Privileged hash-signing input.
 */
export type SignHashInput = {
  readonly accountId?: string;
  readonly messageHash: string;
  readonly vaultPassphrase: string;
};

/**
 * Origin grant input for account access permissions.
 */
export type OriginGrantInput = {
  readonly accountId?: string;
  readonly origin: string;
  readonly vaultPassphrase: string;
};

/**
 * Origin revocation input for the connected-sites permissions manager.
 */
export type RevokeOriginInput = {
  readonly origin: string;
  readonly vaultPassphrase: string;
};

/**
 * A site with a persisted origin grant plus how many accounts it can see.
 */
export type ConnectedSite = {
  readonly accountCount: number;
  readonly origin: string;
};

/**
 * Derives the connected-sites list (origin plus granted account count) from a
 * decrypted vault, ordered by origin for stable rendering. Pure helper reused
 * by the connected-sites reader and by revocation responses.
 */
export const connectedSitesFromVault = (vault: Vault): readonly ConnectedSite[] =>
  vault.originGrants
    .map((grant) => ({ accountCount: grant.accountIds.length, origin: grant.origin }))
    .sort((left, right) => left.origin.localeCompare(right.origin));

/**
 * Active account selection input.
 */
export type SetActiveAccountInput = {
  readonly accountId: string;
  readonly vaultPassphrase: string;
};

/**
 * Input for deriving the selected wallet account onto another Starknet network.
 */
export type EnsureNetworkAccountInput = {
  readonly networkId: StarknetNetworkId;
  readonly vaultPassphrase: string;
};

/**
 * Input for adding a freshly derived account on a network using the vault's
 * retained recovery phrase.
 */
export type AddDerivedAccountInput = {
  readonly networkId: StarknetNetworkId;
  readonly vaultPassphrase: string;
};

/**
 * Re-authenticated secret export for the active account. Returned only to the
 * privileged reveal flow and never persisted or logged. `mnemonic` is `null`
 * when the vault predates recovery-phrase retention.
 */
export type RevealedSecrets = {
  readonly mnemonic: string | null;
  readonly privateKey: string;
};

/**
 * Privileged encrypted-vault wallet service surface.
 */
export type WalletVaultService = {
  readonly addDerivedAccount: (input: AddDerivedAccountInput) => Promise<AccountRef>;
  readonly createAccount: (input: CreateVaultAccountInput) => Promise<AccountRef>;
  readonly ensureNetworkAccount: (input: EnsureNetworkAccountInput) => Promise<AccountRef>;
  readonly generateMnemonic: () => Promise<string>;
  readonly grantOrigin: (input: OriginGrantInput) => Promise<readonly AccountRef[]>;
  readonly getGrantedAccounts: (
    origin: string,
    vaultPassphrase: string,
  ) => Promise<readonly AccountRef[]>;
  readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
  readonly revokeOrigin: (input: RevokeOriginInput) => Promise<readonly ConnectedSite[]>;
  readonly setActiveAccount: (input: SetActiveAccountInput) => Promise<AccountRef>;
  readonly signHash: (input: SignHashInput) => Promise<StarkSignature>;
  readonly status: () => Promise<WalletStatus>;
};

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

const sameWalletKey = (left: AccountRef, right: AccountRef): boolean =>
  left.publicKeyX === right.publicKeyX &&
  left.publicKeyY === right.publicKeyY &&
  left.derivation.accountIndex === right.derivation.accountIndex &&
  left.derivation.addressIndex === right.derivation.addressIndex;

const nextAccountIndex = (
  accounts: readonly AccountRef[],
  networkId: StarknetNetworkId,
): number => {
  const used = new Set(
    accounts
      .filter((account) => account.networkId === networkId)
      .map((account) => account.derivation.accountIndex),
  );
  let index = 0;
  while (used.has(index)) {
    index += 1;
  }
  return index;
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
    async ensureNetworkAccount(input) {
      const vault = await readVaultSnapshot(input.vaultPassphrase);
      const source =
        (vault.activeAccountId
          ? vault.accounts.find((stored) => stored.id === vault.activeAccountId)
          : null) ?? vault.accounts[0];
      if (!source) {
        throw new WalletError("No account selected");
      }

      const existing = vault.accounts.find(
        (stored) => stored.networkId === input.networkId && sameWalletKey(stored, source),
      );
      if (existing) {
        await writeVault(
          encryptedStore,
          { ...vault, activeAccountId: existing.id },
          input.vaultPassphrase,
        );
        return existing;
      }

      const signingKey = vault.signingKeys.find((stored) => stored.accountId === source.id);
      if (!signingKey) {
        throw new WalletError("Signing key unavailable");
      }

      const classHash = await getOzAccountClassHash(kms, input.networkId);
      const address = await kms.deriveOzAccountAddress(source.publicKeyX, classHash);
      if (!isNonZeroStarkFieldElement(address)) {
        throw new WalletError("Krusty KMS returned invalid account address");
      }

      const account: AccountRef = {
        ...source,
        address,
        classHash,
        id: `${input.networkId}:${address}`,
        networkId: input.networkId,
      };
      if (vault.accounts.some((stored) => stored.id === account.id)) {
        throw new WalletError("Account already exists");
      }

      await writeVault(
        encryptedStore,
        {
          ...vault,
          accounts: [...vault.accounts, account],
          activeAccountId: account.id,
          signingKeys: [
            ...vault.signingKeys,
            { accountId: account.id, privateKey: signingKey.privateKey },
          ],
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
    createAccount: (input) => serialized(() => service.createAccount(input)),
    ensureNetworkAccount: (input) => serialized(() => service.ensureNetworkAccount(input)),
    grantOrigin: (input) => serialized(() => service.grantOrigin(input)),
    revokeOrigin: (input) => serialized(() => service.revokeOrigin(input)),
    setActiveAccount: (input) => serialized(() => service.setActiveAccount(input)),
  };
};
