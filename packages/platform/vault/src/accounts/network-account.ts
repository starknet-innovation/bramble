/**
 * Pure selection plus KMS-backed derivation for projecting one wallet key onto
 * another Starknet network. Kept beside the vault boundary because software
 * account projections must copy only the encrypted signing-key reference,
 * while Ledger projections remain keyless.
 */

import { WalletError } from "@mc-wallet/core/errors";
import {
  type AccountRef,
  isKeylessAccount,
  isLedgerAccount,
} from "@mc-wallet/wallet-model/accounts";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
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
      (source.accountContractType !== "argent" ||
        (stored.accountContractType === "argent" &&
          sameFelt(stored.deploymentSalt, source.deploymentSalt))) &&
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
  if (isLedgerAccount(source)) {
    const account = await deriveLedgerAccount(kms, {
      accountContractType: source.accountContractType,
      accountIndex: source.derivation.accountIndex,
      ...(source.deploymentSalt === undefined ? {} : { deploymentSalt: source.deploymentSalt }),
      eip2645application: source.derivation.eip2645application,
      networkId,
      publicKeyX: source.publicKeyX,
    });
    return { account, signingKeys: [] };
  }
  if (isKeylessAccount(source)) {
    // A paired-phone account is not projected. Its address derives from the
    // account class declared on the target network, and the ML-DSA contract has
    // no pinned class hash yet, so there is nothing to derive against there —
    // enrolling on that network is the supported route. Refuse rather than fall
    // through to the vault lookup, which would report a missing signing key
    // instead and send the user looking for the wrong thing.
    // TODO: Blocked
    throw new WalletError("Post-quantum accounts cannot be projected onto another network");
  }
  const signingKey = vault.signingKeys.find((stored) => stored.accountId === source.id);
  if (!signingKey) {
    throw new WalletError("Signing key unavailable");
  }
  const projection = await deriveAccountContractAddress(kms, {
    accountContractType: source.accountContractType,
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

/**
 * Projects the selected account onto one network and makes it active, or selects
 * the existing projection when there already is one.
 *
 * Lives beside {@link deriveNetworkAccount} rather than in the vault service so
 * the read, the derivation, and the write are one unit: a projection that wrote
 * an account without its signing key, or a signing key without its account,
 * would break the vault's account/key bijection and refuse to decrypt. Refuses
 * a duplicate rather than overwriting one.
 */
export const storeNetworkAccount = async (
  deps: {
    readonly kms: KmsPort;
    readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
    readonly writeVault: (next: Vault, vaultPassphrase: string) => Promise<void>;
  },
  input: { readonly networkId: StarknetNetworkId; readonly vaultPassphrase: string },
): Promise<AccountRef> => {
  const vault = await deps.readVault(input.vaultPassphrase);
  const source = selectSourceAccount(vault);
  if (!source) {
    throw new WalletError("No account selected");
  }
  const existing = findNetworkAccount(vault, input.networkId, source);
  if (existing) {
    await deps.writeVault({ ...vault, activeAccountId: existing.id }, input.vaultPassphrase);
    return existing;
  }
  // Missing projection key material fails closed in the helper.
  const { account, signingKeys } = await deriveNetworkAccount(
    deps.kms,
    vault,
    source,
    input.networkId,
  );
  if (vault.accounts.some((stored) => stored.id === account.id)) {
    throw new WalletError("Account already exists");
  }
  await deps.writeVault(
    {
      ...vault,
      accounts: [...vault.accounts, account],
      activeAccountId: account.id,
      signingKeys: [...vault.signingKeys, ...signingKeys],
    },
    input.vaultPassphrase,
  );
  return account;
};
