/**
 * Starknet account derivation through Krusty KMS with no local crypto fallback.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { verifyStarkSignature } from "@mc-wallet/starknet/signature-verify";
import type {
  AccountRef,
  DerivedAccountRef,
  ImportedAccountRef,
  LedgerAccountRef,
  StarkCurveContractType,
} from "@mc-wallet/wallet-model/accounts";
import {
  isLedgerAccountIndex,
  LEDGER_EIP2645_APPLICATION,
  type LedgerPubKeyEntry,
  ledgerAccountPath,
} from "@mc-wallet/wallet-model/ledger-path";
import {
  canonicalFelt,
  DEFAULT_NETWORK,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  isStarkPrivateKey,
  type StarknetNetworkId,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { isMnemonicPassphrase, isMnemonicText } from "@mc-wallet/wallet-model/passphrase";
import type { KmsPort } from "../kms-port";
import { deriveAccountContractAddress, resolveAccountClassHash } from "./account-contract";

/** Account-contract class and address helpers exposed through this package subpath. */
export { deriveAccountContractAddress, getOzAccountClassHash } from "./account-contract";

// Krusty owns the private-key -> public-key mapping; the wallet must never
// derive it locally. `signStarkHash` is the one KMS export that returns the
// stark public key for a private key, so a raw-key import recovers the account
// public key from a signature over this fixed probe hash and discards `r`/`s`.
const PUBLIC_KEY_PROBE_HASH = "0x1";

/**
 * Account derivation input accepted by the Krusty-backed wallet boundary.
 */
export type AccountDerivationInput = {
  readonly accountContractType: StarkCurveContractType;
  readonly accountIndex?: number;
  readonly addressIndex?: number;
  readonly classHash?: string;
  readonly deploymentSalt?: string;
  readonly mnemonic: string;
  readonly mnemonicPassphrase?: string;
  readonly networkId?: StarknetNetworkId;
};

/**
 * Account derivation output with private key separated from public metadata.
 */
export type AccountDerivationResult = {
  readonly account: DerivedAccountRef;
  readonly privateKey: string;
};

/**
 * Raw-private-key import input accepted by the Krusty-backed wallet boundary.
 */
export type ImportedAccountInput = {
  readonly accountContractType: StarkCurveContractType;
  readonly classHash?: string;
  readonly deploymentSalt?: string;
  readonly networkId?: StarknetNetworkId;
  readonly privateKey: string;
};

/**
 * Imported-account output with the raw private key separated from public
 * metadata; the key is routed straight to the encrypted vault by the caller.
 */
export type ImportedAccountResult = {
  readonly account: ImportedAccountRef;
  readonly privateKey: string;
};

const isDerivationIndex = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

const requireDerivationInput = (input: AccountDerivationInput): void => {
  if (!isMnemonicText(input.mnemonic) || !isMnemonicPassphrase(input.mnemonicPassphrase)) {
    throw new WalletError("Invalid mnemonic derivation input");
  }
};

const canonicalKeypair = (
  value: Awaited<ReturnType<KmsPort["deriveStarknetKeypair"]>>,
): { readonly privateKey: string; readonly publicKeyX: string; readonly publicKeyY: string } => {
  if (
    !isStarkPrivateKey(value.privateKey) ||
    ![value.publicKeyX, value.publicKeyY].every(isNonZeroStarkFieldElement)
  ) {
    throw new WalletError("Krusty KMS returned invalid account key material");
  }
  return {
    privateKey: canonicalFelt(value.privateKey) as string,
    publicKeyX: canonicalFelt(value.publicKeyX) as string,
    publicKeyY: canonicalFelt(value.publicKeyY) as string,
  };
};

/**
 * Derives account metadata and signing key through Krusty KMS only.
 */
export const deriveAccount = async (
  kms: KmsPort,
  input: AccountDerivationInput,
): Promise<AccountDerivationResult> => {
  requireDerivationInput(input);
  if (!(await kms.validateMnemonic(input.mnemonic))) {
    throw new WalletError("Invalid mnemonic");
  }

  const accountIndex = input.accountIndex ?? 0;
  const addressIndex = input.addressIndex ?? 0;
  if (!isDerivationIndex(accountIndex) || !isDerivationIndex(addressIndex)) {
    throw new WalletError("Invalid derivation index");
  }

  const networkId = input.networkId ?? DEFAULT_NETWORK.id;
  if (!isStarknetNetworkId(networkId)) {
    throw new WalletError("Invalid Starknet network");
  }

  const accountContractType = input.accountContractType;
  const resolvedClassHash = await validatedNetworkClassHash(
    kms,
    accountContractType,
    networkId,
    input.classHash,
  );
  const { privateKey, publicKeyX, publicKeyY } = canonicalKeypair(
    await kms.deriveStarknetKeypair(
      input.mnemonic,
      addressIndex,
      accountIndex,
      input.mnemonicPassphrase,
    ),
  );

  const { address, classHash, deploymentSalt } = await deriveAccountContractAddress(kms, {
    classHash: resolvedClassHash,
    accountContractType,
    ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
    networkId,
    publicKeyX,
  });
  const contract =
    accountContractType === "argent"
      ? { accountContractType, deploymentSalt: deploymentSalt as string }
      : { accountContractType };

  return {
    account: {
      ...contract,
      address,
      classHash,
      derivation: {
        accountIndex,
        addressIndex,
        kind: "starknet-bip44",
      },
      id: `${networkId}:${address}`,
      networkId,
      publicKeyX,
      publicKeyY,
    },
    privateKey,
  };
};

/**
 * Ledger account creation input. The public key and its account index come from
 * the device; the derivation path is rebuilt deterministically from the index
 * (one source of truth with the device client), so a stored path always matches
 * the one used to enumerate and sign.
 */
export type LedgerAccountInput = LedgerPubKeyEntry & {
  readonly accountContractType: StarkCurveContractType;
  readonly classHash?: string;
  readonly deploymentSalt?: string;
  readonly eip2645application?: string;
  readonly networkId?: StarknetNetworkId;
};

const validatedNetworkClassHash = async (
  kms: KmsPort,
  accountContractType: StarkCurveContractType,
  networkId: StarknetNetworkId,
  classHash: string | undefined,
): Promise<string> => {
  const resolved = await resolveAccountClassHash(
    kms,
    { accountContractType, ...(classHash ? { classHash } : {}) },
    networkId,
  );
  if (!isNonZeroStarkFieldElement(resolved)) {
    throw new WalletError("Invalid account class hash");
  }
  return canonicalFelt(resolved) as string;
};

/**
 * Derives keyless Ledger account metadata from a device-provided public key.
 *
 * Reuses the same explicit zero-salt Krusty derivation HD and imported accounts
 * use, so the counterfactual address a Ledger account is funded
 * at equals the one it will deploy to. No seed, no private key, and no new Krusty
 * entry point: address derivation from an external public key is a public-key op,
 * not signing, so it does not weaken "Krusty owns crypto / fail closed". Throws a
 * `WalletError` on an out-of-range index or an invalid public key or KMS result.
 */
export const deriveLedgerAccount = async (
  kms: KmsPort,
  input: LedgerAccountInput,
): Promise<LedgerAccountRef> => {
  if (!isLedgerAccountIndex(input.accountIndex)) {
    throw new WalletError("Invalid Ledger account index");
  }
  if (!isNonZeroStarkFieldElement(input.publicKeyX)) {
    throw new WalletError("Invalid Ledger public key");
  }

  const networkId = input.networkId ?? DEFAULT_NETWORK.id;
  if (!isStarknetNetworkId(networkId)) {
    throw new WalletError("Invalid Starknet network");
  }

  const accountContractType = input.accountContractType;
  const resolvedClassHash = await validatedNetworkClassHash(
    kms,
    accountContractType,
    networkId,
    input.classHash,
  );
  const publicKeyX = canonicalFelt(input.publicKeyX) as string;
  const { address, classHash, deploymentSalt } = await deriveAccountContractAddress(kms, {
    classHash: resolvedClassHash,
    accountContractType,
    ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
    networkId,
    publicKeyX,
  });
  const contract =
    accountContractType === "argent"
      ? { accountContractType, deploymentSalt: deploymentSalt as string }
      : { accountContractType };

  return {
    ...contract,
    address,
    classHash,
    derivation: {
      accountIndex: input.accountIndex,
      eip2645application: input.eip2645application ?? LEDGER_EIP2645_APPLICATION,
      kind: "ledger",
      path: ledgerAccountPath(input.accountIndex),
    },
    id: `${networkId}:${address}`,
    networkId,
    publicKeyX,
  };
};

/**
 * Derives account metadata for a batch of enumerated Ledger (index, public key)
 * pairs on one network, resolving the class hash once and deriving addresses in
 * parallel. Backs the multi-index account picker. Throws if any entry is invalid.
 */
export const deriveLedgerAccountRefs = async (
  kms: KmsPort,
  input: {
    readonly accountContractType: StarkCurveContractType;
    readonly classHash?: string;
    readonly deploymentSalt?: string;
    readonly entries: readonly LedgerPubKeyEntry[];
    readonly networkId?: StarknetNetworkId;
  },
): Promise<readonly LedgerAccountRef[]> => {
  const networkId = input.networkId ?? DEFAULT_NETWORK.id;
  if (!isStarknetNetworkId(networkId)) {
    throw new WalletError("Invalid Starknet network");
  }
  const accountContractType = input.accountContractType;
  const classHash = await validatedNetworkClassHash(
    kms,
    accountContractType,
    networkId,
    input.classHash,
  );
  return Promise.all(
    input.entries.map((entry) =>
      deriveLedgerAccount(kms, {
        accountContractType,
        accountIndex: entry.accountIndex,
        classHash,
        ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
        networkId,
        publicKeyX: entry.publicKeyX,
      }),
    ),
  );
};

/**
 * True when two accounts hold the same keypair with the same provenance. The
 * stark public key (`publicKeyX`) identifies the keypair, so HD accounts also
 * match on their derivation indices while imported accounts match on the key.
 */
export const sameWalletKey = (left: AccountRef, right: AccountRef): boolean => {
  if (
    !sameFelt(left.publicKeyX, right.publicKeyX) ||
    left.derivation.kind !== right.derivation.kind
  ) {
    return false;
  }
  return left.derivation.kind === "starknet-bip44" && right.derivation.kind === "starknet-bip44"
    ? left.derivation.accountIndex === right.derivation.accountIndex &&
        left.derivation.addressIndex === right.derivation.addressIndex
    : true;
};

/**
 * Lowest unused HD account index on a network. Imported accounts hold no HD
 * position, so they never occupy an index here.
 */
export const nextAccountIndex = (
  accounts: readonly AccountRef[],
  networkId: StarknetNetworkId,
): number => {
  const used = new Set(
    accounts.flatMap((account) =>
      account.networkId === networkId && account.derivation.kind === "starknet-bip44"
        ? [account.derivation.accountIndex]
        : [],
    ),
  );
  let index = 0;
  while (used.has(index)) {
    index += 1;
  }
  return index;
};

/**
 * Derives only public account metadata for callers that must not receive keys.
 */
export const deriveAccountRef = async (
  kms: KmsPort,
  input: AccountDerivationInput,
): Promise<DerivedAccountRef> => (await deriveAccount(kms, input)).account;

/**
 * Builds an imported account from a raw Starknet private key through Krusty
 * KMS only. Validates the key is a non-zero in-range felt, recovers the account
 * public key via Krusty (never locally), and derives the OZ account address the
 * same way HD accounts do. Throws a `WalletError` on an invalid key or an
 * invalid KMS result; performs no persistence and never logs the key.
 */
export const deriveImportedAccount = async (
  kms: KmsPort,
  input: ImportedAccountInput,
): Promise<ImportedAccountResult> => {
  if (!isStarkPrivateKey(input.privateKey)) {
    throw new WalletError("Invalid private key");
  }
  const privateKey = canonicalFelt(input.privateKey) as string;

  const networkId = input.networkId ?? DEFAULT_NETWORK.id;
  if (!isStarknetNetworkId(networkId)) {
    throw new WalletError("Invalid Starknet network");
  }

  const accountContractType = input.accountContractType;
  const resolvedClassHash = await validatedNetworkClassHash(
    kms,
    accountContractType,
    networkId,
    input.classHash,
  );
  const probe = await kms.signStarkHash(privateKey, PUBLIC_KEY_PROBE_HASH);
  if (!isNonZeroStarkFieldElement(probe.publicKey)) {
    throw new WalletError("Krusty KMS returned invalid public key");
  }
  const publicKeyX = canonicalFelt(probe.publicKey) as string;
  if (
    !verifyStarkSignature({
      hash: PUBLIC_KEY_PROBE_HASH,
      publicKeyX,
      signature: probe,
    })
  ) {
    throw new WalletError("Krusty KMS public-key probe did not verify");
  }

  const { address, classHash, deploymentSalt } = await deriveAccountContractAddress(kms, {
    classHash: resolvedClassHash,
    accountContractType,
    ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
    networkId,
    publicKeyX,
  });
  const contract =
    accountContractType === "argent"
      ? { accountContractType, deploymentSalt: deploymentSalt as string }
      : { accountContractType };

  return {
    account: {
      ...contract,
      address,
      classHash,
      derivation: { kind: "imported-raw-key" },
      id: `${networkId}:${address}`,
      networkId,
      publicKeyX,
    },
    privateKey,
  };
};
