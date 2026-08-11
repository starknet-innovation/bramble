/**
 * Starknet account derivation through Krusty KMS with no local crypto fallback.
 */

import { WalletError } from "@mc-wallet/core/errors";
import { isRecord } from "@mc-wallet/core/json";
import type {
  AccountRef,
  DerivedAccountRef,
  ImportedAccountRef,
  LedgerAccountRef,
  LedgerPubKeyEntry,
} from "@mc-wallet/wallet-model/accounts";
import {
  isLedgerAccountIndex,
  LEDGER_EIP2645_APPLICATION,
  ledgerAccountPath,
} from "@mc-wallet/wallet-model/ledger-path";
import {
  DEFAULT_NETWORK,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  isStarkPrivateKey,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import type { KmsPort } from "../kms-port";

const OZ_ACCOUNT_VERSION = "3.0.0";

// Krusty owns the private-key -> public-key mapping; the wallet must never
// derive it locally. `signStarkHash` is the one KMS export that returns the
// stark public key for a private key, so a raw-key import recovers the account
// public key from a signature over this fixed probe hash and discards `r`/`s`.
const PUBLIC_KEY_PROBE_HASH = "0x1";

/**
 * Account derivation input accepted by the Krusty-backed wallet boundary.
 */
export type AccountDerivationInput = {
  readonly accountIndex?: number;
  readonly addressIndex?: number;
  readonly classHash?: string;
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
  readonly classHash?: string;
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

const parseClassHashes = (json: string): unknown => {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new WalletError("Krusty KMS returned invalid class hash JSON");
  }
};

const isDerivationIndex = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

const ownValue = (record: Record<string, unknown>, field: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  return descriptor?.enumerable === true && "value" in descriptor ? descriptor.value : undefined;
};

/**
 * Reads the OpenZeppelin account class hash from Krusty for a network.
 */
export const getOzAccountClassHash = async (
  kms: KmsPort,
  networkId: StarknetNetworkId,
): Promise<string> => {
  const hashes = parseClassHashes(await kms.getAccountClassHashes());
  const ozHashes = isRecord(hashes) ? ownValue(hashes, "oz") : null;

  if (!isRecord(ozHashes)) {
    throw new WalletError("Krusty KMS class hashes are missing oz accounts");
  }

  const version = ownValue(ozHashes, OZ_ACCOUNT_VERSION);
  const classHash = isRecord(version) ? ownValue(version, networkId) : null;
  if (typeof classHash !== "string") {
    throw new WalletError(`Krusty KMS class hashes are missing ${networkId}`);
  }

  if (!isNonZeroStarkFieldElement(classHash)) {
    throw new WalletError("Krusty KMS returned an invalid class hash");
  }
  return classHash;
};

/**
 * Derives account metadata and signing key through Krusty KMS only.
 */
export const deriveAccount = async (
  kms: KmsPort,
  input: AccountDerivationInput,
): Promise<AccountDerivationResult> => {
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

  const classHash = input.classHash ?? (await getOzAccountClassHash(kms, networkId));
  if (!isNonZeroStarkFieldElement(classHash)) {
    throw new WalletError("Invalid account class hash");
  }

  const { privateKey, publicKeyX, publicKeyY } = await kms.deriveStarknetKeypair(
    input.mnemonic,
    addressIndex,
    accountIndex,
    input.mnemonicPassphrase,
  );
  if (
    !isNonZeroStarkFieldElement(privateKey) ||
    ![publicKeyX, publicKeyY].every(isNonZeroStarkFieldElement)
  ) {
    throw new WalletError("Krusty KMS returned invalid account key material");
  }

  const address = await kms.deriveOzAccountAddress(publicKeyX, classHash);
  if (!isNonZeroStarkFieldElement(address)) {
    throw new WalletError("Krusty KMS returned invalid account address");
  }

  return {
    account: {
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
  readonly classHash?: string;
  readonly eip2645application?: string;
  readonly networkId?: StarknetNetworkId;
};

const validatedNetworkClassHash = async (
  kms: KmsPort,
  networkId: StarknetNetworkId,
  classHash: string | undefined,
): Promise<string> => {
  const resolved = classHash ?? (await getOzAccountClassHash(kms, networkId));
  if (!isNonZeroStarkFieldElement(resolved)) {
    throw new WalletError("Invalid account class hash");
  }
  return resolved;
};

/**
 * Derives keyless Ledger account metadata from a device-provided public key.
 *
 * Reuses the same `kms.deriveOzAccountAddress(publicKeyX, classHash)` call HD and
 * imported accounts use, so the counterfactual address a Ledger account is funded
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

  const classHash = await validatedNetworkClassHash(kms, networkId, input.classHash);
  const address = await kms.deriveOzAccountAddress(input.publicKeyX, classHash);
  if (!isNonZeroStarkFieldElement(address)) {
    throw new WalletError("Krusty KMS returned invalid account address");
  }

  return {
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
    publicKeyX: input.publicKeyX,
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
    readonly classHash?: string;
    readonly entries: readonly LedgerPubKeyEntry[];
    readonly networkId?: StarknetNetworkId;
  },
): Promise<readonly LedgerAccountRef[]> => {
  const networkId = input.networkId ?? DEFAULT_NETWORK.id;
  if (!isStarknetNetworkId(networkId)) {
    throw new WalletError("Invalid Starknet network");
  }
  const classHash = await validatedNetworkClassHash(kms, networkId, input.classHash);
  return Promise.all(
    input.entries.map((entry) =>
      deriveLedgerAccount(kms, {
        accountIndex: entry.accountIndex,
        classHash,
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
  if (left.publicKeyX !== right.publicKeyX || left.derivation.kind !== right.derivation.kind) {
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
  const privateKey = input.privateKey;
  if (!isStarkPrivateKey(privateKey)) {
    throw new WalletError("Invalid private key");
  }

  const networkId = input.networkId ?? DEFAULT_NETWORK.id;
  if (!isStarknetNetworkId(networkId)) {
    throw new WalletError("Invalid Starknet network");
  }

  const classHash = input.classHash ?? (await getOzAccountClassHash(kms, networkId));
  if (!isNonZeroStarkFieldElement(classHash)) {
    throw new WalletError("Invalid account class hash");
  }

  const { publicKey: publicKeyX } = await kms.signStarkHash(privateKey, PUBLIC_KEY_PROBE_HASH);
  if (!isNonZeroStarkFieldElement(publicKeyX)) {
    throw new WalletError("Krusty KMS returned invalid public key");
  }

  const address = await kms.deriveOzAccountAddress(publicKeyX, classHash);
  if (!isNonZeroStarkFieldElement(address)) {
    throw new WalletError("Krusty KMS returned invalid account address");
  }

  return {
    account: {
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
