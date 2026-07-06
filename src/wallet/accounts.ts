/**
 * Starknet account derivation through Krusty KMS with no local crypto fallback.
 */
import type { KrustyKms } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { isRecord } from "../shared/json";
import {
  DEFAULT_NETWORK,
  isNonZeroStarkFieldElement,
  type StarknetNetworkId,
} from "../starknet/networks";
import type { AccountRef } from "../storage/vault-schema";

const OZ_ACCOUNT_VERSION = "3.0.0";

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
  readonly account: AccountRef;
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

/**
 * Reads the OpenZeppelin account class hash from Krusty for a network.
 */
export const getOzAccountClassHash = async (
  kms: KrustyKms,
  networkId: StarknetNetworkId,
): Promise<string> => {
  const hashes = parseClassHashes(await kms.getAccountClassHashes());

  if (!isRecord(hashes) || !isRecord(hashes.oz)) {
    throw new WalletError("Krusty KMS class hashes are missing oz accounts");
  }

  const version = hashes.oz[OZ_ACCOUNT_VERSION];
  if (!isRecord(version) || typeof version[networkId] !== "string") {
    throw new WalletError(`Krusty KMS class hashes are missing ${networkId}`);
  }

  const classHash = version[networkId];
  if (!isNonZeroStarkFieldElement(classHash)) {
    throw new WalletError("Krusty KMS returned an invalid class hash");
  }
  return classHash;
};

/**
 * Derives account metadata and signing key through Krusty KMS only.
 */
export const deriveAccount = async (
  kms: KrustyKms,
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
 * Derives only public account metadata for callers that must not receive keys.
 */
export const deriveAccountRef = async (
  kms: KrustyKms,
  input: AccountDerivationInput,
): Promise<AccountRef> => (await deriveAccount(kms, input)).account;
