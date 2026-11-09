/**
 * Pure selection plus KMS-backed derivation for projecting one wallet key onto
 * another Starknet network. Kept beside the vault boundary because software
 * account projections must copy only the encrypted signing-key reference,
 * while Ledger projections remain keyless.
 */

import { WalletError } from "@bramble/core/errors";
import { type AccountRef, isKeylessAccount } from "@bramble/wallet-model/accounts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { sameFelt } from "@bramble/wallet-model/networks";
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
      sameAccountContract(stored, source) &&
      sameWalletKey(stored, source),
  );

// OpenZeppelin's class is chosen per network, so it cannot tell two projections
// apart. Every other family's address is fixed by the class it was deployed
// with and its salt, which is the same account on every network: one key at two
// Argent releases is two accounts, and must not match as one.
const sameAccountContract = (stored: AccountRef, source: AccountRef): boolean =>
  stored.accountContractType === source.accountContractType &&
  (source.accountContractType === "openzeppelin" ||
    (sameFelt(stored.classHash, source.classHash) &&
      sameFelt(stored.deploymentSalt, source.deploymentSalt)));

// The deploy class travels with the account for the same reason; left out, it
// would fall back to the release this wallet creates, which is another address.
const deployClass = (source: AccountRef): { readonly classHash?: string } =>
  source.accountContractType === "openzeppelin" ? {} : { classHash: source.classHash };

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
      ...deployClass(source),
      ...(source.deploymentSalt === undefined ? {} : { deploymentSalt: source.deploymentSalt }),
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
    ...deployClass(source),
    ...(source.deploymentSalt === undefined ? {} : { deploymentSalt: source.deploymentSalt }),
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
