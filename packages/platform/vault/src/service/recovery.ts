/** Atomic multi-account restoration inside the encrypted vault boundary. */
import { RefusedBeforeWrite, WalletError } from "@bramble/core/errors";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import {
  isRecoveryAccountSelection,
  RECOVERY_SCAN_LIMITS,
  type RecoveryAccountSelection,
  recoverySelectionKey,
  selectionDerivation,
} from "@bramble/wallet-model/recovery";
import { type AccountDerivationResult, deriveAccount } from "../accounts/accounts";
import type { EncryptedStore } from "../encrypted-store";
import type { KmsPort } from "../kms-port";
import { isVaultV12, type Vault } from "../schema/schema";
import { requireVaultCapacity } from "./vault-capacity";

/** Privileged recovery input; the phrase and unlock credential never leave this boundary. */
export type RecoverVaultAccountsInput = {
  readonly mnemonic: string;
  readonly networkId: StarknetNetworkId;
  readonly selections: readonly RecoveryAccountSelection[];
  readonly vaultPassphrase: string;
};

// A selection found by its address (issue 398) keeps that address: the
// coordinate derives the signing key, and the background matched that key
// against the account's live owner before this write. Every other selection
// records the address its coordinate derives.
const deriveSelection = async (
  kms: KmsPort,
  selection: RecoveryAccountSelection,
  base: {
    readonly mnemonic: string;
    readonly networkId: StarknetNetworkId;
    readonly seedId?: string;
  },
): Promise<AccountDerivationResult> => {
  const { address, ...coordinate } = selection;
  const derived = await deriveAccount(kms, {
    ...coordinate,
    // Stamp the family default (issue 505): the vault's own default stays
    // this wallet's ladder so creation flows are untouched, but a restore
    // means the vendor's scheme unless the selection spelled otherwise.
    derivation: selectionDerivation(selection),
    ...base,
  });
  return address === undefined
    ? derived
    : {
        ...derived,
        account: { ...derived.account, address, id: `${derived.account.networkId}:${address}` },
      };
};

// Derives every selected coordinate with the seed handle stamped in, refusing
// address collisions within the batch and with accounts already in the vault.
const deriveSeedSelections = async (
  kms: KmsPort,
  vault: Vault,
  input: RecoverVaultAccountsInput,
  seedId: string | undefined,
) => {
  const derived = [];
  for (const selection of input.selections) {
    derived.push(
      await deriveSelection(kms, selection, {
        mnemonic: input.mnemonic,
        networkId: input.networkId,
        ...(seedId === undefined ? {} : { seedId }),
      }),
    );
  }
  const ids = derived.map(({ account }) => account.id);
  if (new Set(ids).size !== ids.length) {
    throw new RefusedBeforeWrite("Recovery accounts resolve to a duplicate address");
  }
  if (vault.accounts.some((stored) => ids.includes(stored.id))) {
    throw new RefusedBeforeWrite("Account already exists");
  }
  return derived;
};

// Bounded, well-formed, and duplicate-free selection coordinates — shared by
// first-run recovery and the in-wallet seed import so both fail identically.
const requireRecoverySelections = (selections: RecoverVaultAccountsInput["selections"]): void => {
  if (
    selections.length === 0 ||
    selections.length > RECOVERY_SCAN_LIMITS.maxSelections ||
    !selections.every(isRecoveryAccountSelection)
  ) {
    throw new RefusedBeforeWrite("Invalid recovery account selection");
  }
  const coordinates = selections.map(recoverySelectionKey);
  if (new Set(coordinates).size !== coordinates.length) {
    throw new RefusedBeforeWrite("Duplicate recovery account selection");
  }
};

/**
 * Re-derives selected coordinates through Krusty and commits every account and
 * signing key together. A derivation or write failure leaves the prior vault
 * intact rather than partially restoring a subset.
 */
export const recoverVaultAccounts = async (
  encryptedStore: EncryptedStore,
  kms: KmsPort,
  readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>,
  input: RecoverVaultAccountsInput,
) => {
  requireRecoverySelections(input.selections);

  const vault = await readVaultSnapshot(input.vaultPassphrase);
  if (vault.accounts.length > 0 || vault.mnemonic !== null) {
    throw new RefusedBeforeWrite("Wallet already exists");
  }
  const derived = [];
  for (const selection of input.selections) {
    derived.push(
      await deriveSelection(kms, selection, {
        mnemonic: input.mnemonic,
        networkId: input.networkId,
      }),
    );
  }
  if (new Set(derived.map(({ account }) => account.id)).size !== derived.length) {
    throw new RefusedBeforeWrite("Recovery accounts resolve to a duplicate address");
  }
  const next = {
    ...vault,
    accounts: derived.map(({ account }) => account),
    activeAccountId: derived[0]?.account.id ?? null,
    mnemonic: input.mnemonic,
    signingKeys: derived.map(({ account, privateKey }) => ({ accountId: account.id, privateKey })),
  };
  requireVaultCapacity(next);
  if (!isVaultV12(next)) throw new WalletError("Invalid recovered vault");
  await encryptedStore.write(next, input.vaultPassphrase);
  return next.accounts;
};

/**
 * Imports selected accounts from ANOTHER recovery phrase into an existing
 * unlocked vault. The phrase is retained as an imported seed (reusing the
 * existing entry when the same phrase is imported again, so later imports can
 * add further indices); every selected account derives with that seed's handle
 * stamped into its derivation. Importing the founding phrase derives without a
 * handle — it is the same wallet, not a new seed. Duplicate account ids fail
 * closed, and a derivation or write failure leaves the prior vault intact.
 */
export const importSeedVaultAccounts = async (
  encryptedStore: EncryptedStore,
  kms: KmsPort,
  readVaultSnapshot: (vaultPassphrase: string) => Promise<Vault>,
  input: RecoverVaultAccountsInput,
) => {
  requireRecoverySelections(input.selections);
  if (!(await kms.validateMnemonic(input.mnemonic))) {
    throw new RefusedBeforeWrite("Invalid mnemonic");
  }

  const vault = await readVaultSnapshot(input.vaultPassphrase);
  const founding = vault.mnemonic !== null && vault.mnemonic === input.mnemonic;
  const existing = vault.importedSeeds.find((seed) => seed.mnemonic === input.mnemonic);
  const seedId = founding
    ? undefined
    : (existing?.id ?? `phrase-${vault.importedSeeds.length + 1}`);
  const derived = await deriveSeedSelections(kms, vault, input, seedId);

  const next = {
    ...vault,
    accounts: [...vault.accounts, ...derived.map(({ account }) => account)],
    activeAccountId: derived[0]?.account.id ?? vault.activeAccountId,
    importedSeeds:
      seedId === undefined || existing
        ? vault.importedSeeds
        : [...vault.importedSeeds, { id: seedId, mnemonic: input.mnemonic }],
    signingKeys: [
      ...vault.signingKeys,
      ...derived.map(({ account, privateKey }) => ({ accountId: account.id, privateKey })),
    ],
  };
  requireVaultCapacity(next);
  if (!isVaultV12(next)) throw new WalletError("Invalid imported-seed vault");
  await encryptedStore.write(next, input.vaultPassphrase);
  return derived.map(({ account }) => account);
};
