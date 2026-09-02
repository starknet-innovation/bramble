/** Atomic multi-account restoration inside the encrypted vault boundary. */
import { WalletError } from "@mc-wallet/core/errors";
import { isStarkCurveContractType } from "@mc-wallet/wallet-model/accounts";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import {
  isRecoveryAccountSelection,
  RECOVERY_SCAN_LIMITS,
  type RecoveryAccountSelection,
} from "@mc-wallet/wallet-model/recovery";
import { deriveAccount } from "../accounts/accounts";
import type { EncryptedStore } from "../encrypted-store";
import type { KmsPort } from "../kms-port";
import { isVaultV8, type Vault } from "../schema/schema";

/** Privileged recovery input; the phrase and unlock credential never leave this boundary. */
export type RecoverVaultAccountsInput = {
  readonly mnemonic: string;
  readonly networkId: StarknetNetworkId;
  readonly selections: readonly RecoveryAccountSelection[];
  readonly vaultPassphrase: string;
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
  if (
    input.selections.length === 0 ||
    input.selections.length > RECOVERY_SCAN_LIMITS.maxSelections ||
    !input.selections.every(isRecoveryAccountSelection)
  ) {
    throw new WalletError("Invalid recovery account selection");
  }
  const coordinates = input.selections.map(
    ({ accountContractType, accountIndex }) => `${accountContractType}:${accountIndex}`,
  );
  if (new Set(coordinates).size !== coordinates.length) {
    throw new WalletError("Duplicate recovery account selection");
  }

  const vault = await readVaultSnapshot(input.vaultPassphrase);
  if (vault.accounts.length > 0 || vault.mnemonic !== null) {
    throw new WalletError("Wallet already exists");
  }
  const derived = [];
  for (const { accountContractType, accountIndex } of input.selections) {
    // A paired-phone account's key is generated in the phone's secure hardware
    // and is non-exportable, so no phrase can re-derive it. Restoring one here
    // would write an account whose signer nobody holds, so it fails closed.
    if (!isStarkCurveContractType(accountContractType)) {
      throw new WalletError("A paired-phone account cannot be recovered from a phrase");
    }
    derived.push(
      await deriveAccount(kms, {
        accountContractType,
        accountIndex,
        mnemonic: input.mnemonic,
        networkId: input.networkId,
      }),
    );
  }
  if (new Set(derived.map(({ account }) => account.id)).size !== derived.length) {
    throw new WalletError("Recovery accounts resolve to a duplicate address");
  }
  const next = {
    ...vault,
    accounts: derived.map(({ account }) => account),
    activeAccountId: derived[0]?.account.id ?? null,
    mnemonic: input.mnemonic,
    signingKeys: derived.map(({ account, privateKey }) => ({ accountId: account.id, privateKey })),
  };
  if (!isVaultV8(next)) throw new WalletError("Invalid recovered vault");
  await encryptedStore.write(next, input.vaultPassphrase);
  return next.accounts;
};
