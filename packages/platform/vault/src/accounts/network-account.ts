/**
 * Pure selection plus KMS-backed derivation for projecting one wallet key onto
 * another Starknet network. Kept beside the vault boundary because software
 * account projections must copy only the encrypted signing-key reference,
 * while Ledger projections remain keyless.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { type AccountRef, isKeylessAccount } from "@mc-wallet/wallet-model/accounts";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { KmsPort } from "../kms-port";
import type { SigningKeyRef, Vault } from "../schema/schema";
import { deriveAccountContractAddress, deriveLedgerAccount, sameWalletKey } from "./accounts";

/**
 * The wallet key to project: active when present, otherwise the first account.
 */
export const selectSourceAccount = (vault: Vault): AccountRef | undefined =>
  (vault.activeAccountId
    ? vault.accounts.find((stored) => stored.id === vault.activeAccountId)
    : null) ?? vault.accounts[0];

/**
 * Finds an existing network projection of the same wallet key.
 */
export const findNetworkAccount = (
  vault: Vault,
  networkId: StarknetNetworkId,
  source: AccountRef,
): AccountRef | undefined =>
  vault.accounts.find(
    (stored) =>
      stored.networkId === networkId &&
      stored.accountContractType === source.accountContractType &&
      sameWalletKey(stored, source),
  );

/**
 * Projects a wallet key onto one network. Ledger accounts retain only public
 * derivation coordinates; software accounts require and copy their encrypted
 * signing key reference. Missing key material fails closed.
 */
export const deriveNetworkAccount = async (
  kms: KmsPort,
  vault: Vault,
  source: AccountRef,
  networkId: StarknetNetworkId,
): Promise<{ readonly account: AccountRef; readonly signingKeys: readonly SigningKeyRef[] }> => {
  if (isKeylessAccount(source)) {
    const account = await deriveLedgerAccount(kms, {
      accountContractType: source.accountContractType,
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
  const projection = await deriveAccountContractAddress(kms, {
    accountContractType: source.accountContractType,
    networkId,
    publicKeyX: source.publicKeyX,
  });
  const account: AccountRef = {
    ...source,
    address: projection.address,
    classHash: projection.classHash,
    id: `${networkId}:${projection.address}`,
    networkId,
  };
  return { account, signingKeys: [{ accountId: account.id, privateKey: signingKey.privateKey }] };
};
