/**
 * Wallet vault service: privileged account metadata persistence behind encryption.
 */
import type { KrustyKms, StarkSignature } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { isWalletOrigin } from "../shared/origin";
import { isStarkFieldElement } from "../starknet/networks";
import { type EncryptedStore, isVaultPassphrase } from "../storage/encrypted-store";
import { migrateVault } from "../storage/migrations";
import { assertStoreAccess, type StoreActor } from "../storage/permissioned-store";
import {
  type AccountRef,
  CURRENT_SCHEMA_VERSION,
  isAccountId,
  type Vault,
} from "../storage/vault-schema";
import { type AccountDerivationInput, deriveAccount } from "./accounts";

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
 * Privileged encrypted-vault wallet service surface.
 */
export type WalletVaultService = {
  readonly createAccount: (input: CreateVaultAccountInput) => Promise<AccountRef>;
  readonly grantOrigin: (input: OriginGrantInput) => Promise<readonly AccountRef[]>;
  readonly getGrantedAccounts: (
    origin: string,
    vaultPassphrase: string,
  ) => Promise<readonly AccountRef[]>;
  readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
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

/**
 * Creates the background-only wallet service over encrypted storage and KMS.
 */
export const createWalletVaultService = ({
  actor = "background",
  encryptedStore,
  kms,
}: WalletVaultServiceOptions): WalletVaultService => {
  assertStoreAccess("vault", actor);

  const readVault = async (vaultPassphrase: string): Promise<Vault> => {
    if (!isVaultPassphrase(vaultPassphrase)) {
      throw new WalletError("Passphrase must be at least 12 characters");
    }
    return migrateVault(await encryptedStore.read(vaultPassphrase));
  };

  return {
    async createAccount(input) {
      const vault = await readVault(input.vaultPassphrase);
      const { account, privateKey } = await deriveAccount(kms, input);

      if (vault.accounts.some((stored) => stored.id === account.id)) {
        throw new WalletError("Account already exists");
      }

      await writeVault(
        encryptedStore,
        {
          accounts: [...vault.accounts, account],
          activeAccountId: vault.activeAccountId ?? account.id,
          originGrants: vault.originGrants,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          signingKeys: [...vault.signingKeys, { accountId: account.id, privateKey }],
        },
        input.vaultPassphrase,
      );

      return account;
    },
    async grantOrigin(input) {
      if (!isWalletOrigin(input.origin)) {
        throw new WalletError("Invalid origin");
      }

      const vault = await readVault(input.vaultPassphrase);
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
};
