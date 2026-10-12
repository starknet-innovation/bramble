/**
 * Vault- and account-creation writes, split from service.ts on the size
 * budget. Background-only like its owner: every method validates through the
 * caller-supplied snapshot reader (which enforces the passphrase), derives via
 * Krusty KMS, and fails closed — first-run creators refuse to write over an
 * existing vault, and duplicate account ids are rejected before any write.
 * Those refusals are `RefusedBeforeWrite`, so the network-mutation guard keeps
 * the session unlocked for them rather than signing the user out.
 */

import { RefusedBeforeWrite, WalletError } from "@bramble/core/errors";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import {
  deriveAccount,
  deriveImportedAccount,
  deriveLedgerAccount,
  deriveLedgerAccountRefs,
  nextAccountIndex,
  requireOwnLadderAccount,
} from "../accounts/accounts";
import type { EncryptedStore } from "../encrypted-store";
import type { KmsPort } from "../kms-port";
import { CURRENT_SCHEMA_VERSION, isVaultV11, type Vault } from "../schema/schema";
import type { WalletVaultService } from "./service-types";
import { requireVaultCapacity } from "./vault-capacity";

/**
 * Validates and persists a vault snapshot. Refuses to write anything that is
 * not a well-formed current-schema vault, so a buggy caller can never persist
 * a partial or downgraded shape, and names a vault past its capacity before
 * any storage is touched. `beforeCommit` runs after encryption, immediately
 * before the envelope's commit starts; throwing there abandons the write with
 * none of it stored. (Reading the previous envelope first may repair its
 * commit records, as any read does.)
 */
export const writeVault = async (
  encryptedStore: EncryptedStore,
  vault: Vault,
  vaultPassphrase: string,
  beforeCommit?: () => void,
): Promise<void> => {
  requireVaultCapacity(vault);
  if (!isVaultV11(vault)) {
    throw new WalletError("Invalid vault");
  }
  await encryptedStore.write(vault, vaultPassphrase, beforeCommit);
};

type VaultCreationDeps = {
  readonly encryptedStore: EncryptedStore;
  readonly kms: KmsPort;
  readonly readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>;
};

type VaultCreationMethods = Pick<
  WalletVaultService,
  | "addDerivedAccount"
  | "addLedgerAccount"
  | "createAccount"
  | "createKeyVault"
  | "createLedgerVault"
  | "deriveLedgerAccounts"
  | "importRawKeyAccount"
>;

// The next free HD account on a network. An index whose derived account is
// already in the vault under another derivation, such as the raw-key import
// of that same key, is skipped rather than refused (Sherlock 226): refusing
// it left every later account on the network failing on the same index. Each
// skip matches a distinct stored account, so the walk ends within their count.
const deriveNextFreeAccount = async (
  kms: VaultCreationDeps["kms"],
  vault: Vault,
  input: Omit<Parameters<typeof deriveAccount>[1], "accountIndex" | "networkId"> & {
    readonly networkId: StarknetNetworkId;
  },
): Promise<{ readonly account: DerivedAccountRef; readonly privateKey: string }> => {
  const taken = new Set<number>();
  for (let attempt = 0; attempt <= vault.accounts.length; attempt += 1) {
    const accountIndex = nextAccountIndex(vault.accounts, input.networkId, undefined, taken);
    const { account: derived, privateKey } = await deriveAccount(kms, { ...input, accountIndex });
    const account = requireOwnLadderAccount(derived);
    if (!vault.accounts.some((stored) => stored.id === account.id)) {
      return { account, privateKey };
    }
    taken.add(accountIndex);
  }
  throw new RefusedBeforeWrite("Account already exists");
};

/**
 * The service methods that create vaults or add accounts. Split from the main
 * factory purely by size budget; trust boundaries and failure behavior are
 * unchanged and documented on {@link WalletVaultService}.
 */
export const vaultCreationMethods = ({
  encryptedStore,
  kms,
  readVaultSnapshot,
}: VaultCreationDeps): VaultCreationMethods => ({
  async addDerivedAccount(input) {
    const vault = await readVaultSnapshot(input.vaultPassphrase);
    if (!vault.mnemonic) {
      throw new RefusedBeforeWrite("No recovery phrase stored for this wallet");
    }
    const { account, privateKey } = await deriveNextFreeAccount(kms, vault, {
      accountContractType: input.accountContractType,
      mnemonic: vault.mnemonic,
      networkId: input.networkId,
    });

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
    // Never displace the one recovery phrase the user backed up.
    const displacesStoredSeed =
      vault.mnemonic === null ? vault.accounts.length > 0 : vault.mnemonic !== input.mnemonic;
    if (displacesStoredSeed) {
      throw new RefusedBeforeWrite("Wallet already exists");
    }
    const { account: derived, privateKey } = await deriveAccount(kms, input);
    const account = requireOwnLadderAccount(derived);

    if (vault.accounts.some((stored) => stored.id === account.id)) {
      throw new RefusedBeforeWrite("Account already exists");
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
      accountContractType: input.accountContractType,
      ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
      networkId: input.networkId,
      privateKey: input.privateKey,
    });
    if (vault.accounts.some((stored) => stored.id === account.id)) {
      throw new RefusedBeforeWrite("Account already exists");
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
      accountContractType: input.accountContractType,
      accountIndex: input.accountIndex,
      ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
      networkId: input.networkId,
      publicKeyX: input.publicKeyX,
      ...(input.eip2645application ? { eip2645application: input.eip2645application } : {}),
    });
    if (vault.accounts.some((stored) => stored.id === account.id)) {
      throw new RefusedBeforeWrite("Account already exists");
    }

    // Ledger accounts have no matching signing-key entry.
    await writeVault(
      encryptedStore,
      { ...vault, accounts: [...vault.accounts, account], activeAccountId: account.id },
      input.vaultPassphrase,
    );

    return account;
  },
  async createKeyVault(input) {
    const vault = await readVaultSnapshot(input.vaultPassphrase);
    // A phrase-less imported-key vault can only be created over a fresh store.
    if (vault.accounts.length > 0 || vault.mnemonic !== null) {
      throw new RefusedBeforeWrite("Wallet already exists");
    }
    const { account, privateKey } = await deriveImportedAccount(kms, {
      accountContractType: input.accountContractType,
      ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
      networkId: input.networkId,
      privateKey: input.privateKey,
    });

    // No recovery phrase exists to retain: the vault stays mnemonic-less.
    await writeVault(
      encryptedStore,
      {
        accounts: [account],
        accountSecrets: [],
        activeAccountId: account.id,
        importedSeeds: [],
        mnemonic: null,
        originGrants: [],
        schemaVersion: CURRENT_SCHEMA_VERSION,
        signingKeys: [{ accountId: account.id, privateKey }],
      },
      input.vaultPassphrase,
    );

    return account;
  },
  async createLedgerVault(input) {
    const vault = await readVaultSnapshot(input.vaultPassphrase);
    // A mnemonic-less Ledger vault can only be created over a fresh store.
    if (vault.accounts.length > 0 || vault.mnemonic !== null) {
      throw new RefusedBeforeWrite("Wallet already exists");
    }
    const account = await deriveLedgerAccount(kms, {
      accountContractType: input.accountContractType,
      accountIndex: input.accountIndex,
      ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
      networkId: input.networkId,
      publicKeyX: input.publicKeyX,
      ...(input.eip2645application ? { eip2645application: input.eip2645application } : {}),
    });

    // Ledger stays keyless: no mnemonic and no signing-key entry.
    await writeVault(
      encryptedStore,
      {
        accounts: [account],
        accountSecrets: [],
        activeAccountId: account.id,
        importedSeeds: [],
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
    return deriveLedgerAccountRefs(kms, {
      accountContractType: input.accountContractType,
      ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
      ...(input.eip2645application === undefined
        ? {}
        : { eip2645application: input.eip2645application }),
      entries: input.entries,
      networkId: input.networkId,
    });
  },
});
