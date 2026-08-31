/**
 * Building the public record for a paired post-quantum account.
 *
 * Split from `./accounts` because it shares nothing with the key-derived paths
 * there: no recovery phrase, no imported key, no derivation index, and an address that
 * comes from the account contract's own class rather than from a Stark public
 * key. The ML-DSA key never leaves the device; only its public half arrives.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { MobilePqAccountRef } from "@mc-wallet/wallet-model/accounts";
import {
  canonicalFelt,
  DEFAULT_NETWORK,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import { isMlDsa65PublicKey } from "@mc-wallet/wallet-model/signing";
import type { KmsPort } from "../kms-port";
import type { Vault } from "../schema/schema";
import { deriveAccountContractAddress } from "./account-contract";

/**
 * What enrolling a paired post-quantum device needs. `classHash` is required and
 * never resolved for the caller: the ML-DSA account contract has no pinned
 * release yet, so there is no network default to fall back on, and inheriting
 * another family's class would derive an address nobody holds the key for.
 */
export type MobilePqAccountInput = {
  readonly classHash: string;
  readonly deviceId: string;
  readonly networkId?: StarknetNetworkId;
  readonly publicKey: string;
};

/**
 * Builds the public record for a paired post-quantum account from the device's
 * encoded public key and the class it will run.
 *
 * Holds no signing material: the ML-DSA key never leaves the device, and
 * `publicKey` is its public half, and the address derives from it: the contract
 * commits to the key's packed expansion, which `mlDsaKeyCommitment` computes.
 * Fails closed on a malformed key — an address derived from the wrong preimage
 * is unspendable, and anything sent to it is lost.
 */
export const deriveMobilePqAccount = async (
  kms: KmsPort,
  input: MobilePqAccountInput,
): Promise<MobilePqAccountRef> => {
  if (!isMlDsa65PublicKey(input.publicKey)) {
    throw new WalletError("Invalid post-quantum public key");
  }
  if (input.deviceId.length === 0) {
    throw new WalletError("Invalid post-quantum device id");
  }
  const networkId = input.networkId ?? DEFAULT_NETWORK.id;
  if (!isStarknetNetworkId(networkId)) {
    throw new WalletError("Invalid Starknet network");
  }
  // The record's single identity felt is the same commitment the contract binds
  // in its address, not a second hash of the key that happens to look like one.
  // A 1952-byte key does not fit a felt, and the account model needs one for
  // record identity and duplicate detection.
  const publicKeyX = canonicalFelt(await kms.mlDsaKeyCommitment(input.publicKey));
  if (publicKeyX === null || !isNonZeroStarkFieldElement(publicKeyX)) {
    throw new WalletError("Invalid post-quantum key identity");
  }
  const { address, classHash } = await deriveAccountContractAddress(kms, {
    accountContractType: "ml-dsa",
    classHash: input.classHash,
    networkId,
    publicKey: input.publicKey,
    publicKeyX,
  });
  return {
    accountContractType: "ml-dsa",
    address,
    classHash,
    derivation: {
      deviceId: input.deviceId,
      kind: "mobile-pq",
      transport: { kind: "clipboard" },
    },
    id: `${networkId}:${address}`,
    networkId,
    publicKey: input.publicKey,
    publicKeyX,
  };
};

/**
 * Stores a newly enrolled paired-phone account and makes it active.
 *
 * Lives here rather than in the vault service so the whole paired-phone account
 * concern is one module. A record is written with **no** `signingKeys` entry,
 * exactly like a Ledger: the ML-DSA key never leaves the device, so the vault
 * holds nothing that could authorize this account on its own. Refuses a
 * duplicate rather than overwriting one.
 */
export const storeMobilePqAccount = async (
  deps: {
    readonly kms: KmsPort;
    readonly readVault: (vaultPassphrase: string) => Promise<Vault>;
    readonly writeVault: (next: Vault, vaultPassphrase: string) => Promise<void>;
  },
  input: MobilePqAccountInput & { readonly vaultPassphrase: string },
): Promise<MobilePqAccountRef> => {
  const vault = await deps.readVault(input.vaultPassphrase);
  const account = await deriveMobilePqAccount(deps.kms, input);
  if (vault.accounts.some((stored) => stored.id === account.id)) {
    throw new WalletError("Account already exists");
  }
  await deps.writeVault(
    { ...vault, accounts: [...vault.accounts, account], activeAccountId: account.id },
    input.vaultPassphrase,
  );
  return account;
};
