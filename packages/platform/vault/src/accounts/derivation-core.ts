/**
 * Core HD-derivation plumbing for the Krusty-backed account boundary: the
 * derivation input/output contracts, their guards, keypair canonicalization,
 * the family-to-axis mapping, and Ready's ETH-seeded scheme (issue 505).
 * Private keys pass through on their way to the encrypted vault and are never
 * logged or persisted here; every KMS result is validated before use.
 */
import { WalletError } from "@bramble/core/errors";
import {
  type AccountContractMetadata,
  type AccountContractType,
  accountContractFields,
  type RecoverableAccountRef,
} from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarkPrivateKey,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import { isMnemonicPassphrase, isMnemonicText } from "@bramble/wallet-model/passphrase";
import type { RecoveryDerivationKind } from "@bramble/wallet-model/recovery";
import type { KmsPort } from "../kms-port";
import { deriveAccountContractAddress } from "./account-contract";

/**
 * Account derivation input accepted by the Krusty-backed wallet boundary.
 */
export type AccountDerivationInput = {
  readonly accountContractType: AccountContractType;
  readonly accountIndex?: number;
  readonly addressIndex?: number;
  readonly classHash?: string;
  readonly deploymentSalt?: string;
  readonly mnemonic: string;
  readonly mnemonicPassphrase?: string;
  /**
   * Key ladder for the derivation. Absent means this wallet's own BIP-44
   * scheme — today's behaviour for every creation path. Recovery passes the
   * family's vendor scheme explicitly (issue 505): `argentx-bip44` derives
   * Ready's ETH-seeded address-axis key and is valid only for Argent.
   */
  readonly derivation?: RecoveryDerivationKind;
  readonly networkId?: StarknetNetworkId;
  /** Imported-seed handle stamped into the derivation; absent = founding phrase. */
  readonly seedId?: string;
};

/**
 * Account derivation output with private key separated from public metadata.
 */
export type AccountDerivationResult = {
  readonly account: RecoverableAccountRef;
  readonly privateKey: string;
};

// Fails closed rather than writing a record the vault schema would refuse: a
// salted family whose derivation returned no salt has no re-derivable address.
/**
 * Builds the stored contract metadata for a derived account, failing closed on
 * a salted family whose derivation returned no salt — such a record would have
 * no re-derivable address.
 */
export const recordContract = (
  accountContractType: AccountContractType,
  deploymentSalt: string | undefined,
): AccountContractMetadata => {
  const contract = accountContractFields(accountContractType, deploymentSalt);
  if (contract === null) {
    throw new WalletError("Invalid account deployment salt");
  }
  return contract;
};

/** True for a non-negative safe-integer derivation index. */
export const isDerivationIndex = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

/** Refuses malformed phrases or passphrases before anything reaches Krusty. */
export const requireDerivationInput = (input: AccountDerivationInput): void => {
  if (!isMnemonicText(input.mnemonic) || !isMnemonicPassphrase(input.mnemonicPassphrase)) {
    throw new WalletError("Invalid mnemonic derivation input");
  }
};

/**
 * Validates and canonicalizes a Krusty keypair result; anything out of range
 * fails closed rather than storing unverifiable key material.
 */
export const canonicalKeypair = (
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
 * Validates and canonicalizes an x-only Krusty keypair result (Ready scheme);
 * anything out of range fails closed.
 */
const canonicalXOnlyKeypair = (
  value: Awaited<ReturnType<KmsPort["deriveArgentLegacyKeypair"]>>,
): { readonly privateKey: string; readonly publicKeyX: string } => {
  if (!isStarkPrivateKey(value.privateKey) || !isNonZeroStarkFieldElement(value.publicKeyX)) {
    throw new WalletError("Krusty KMS returned invalid account key material");
  }
  return {
    privateKey: canonicalFelt(value.privateKey) as string,
    publicKeyX: canonicalFelt(value.publicKeyX) as string,
  };
};

/**
 * A Braavos coordinate walks the vendor's address axis; everything else keeps
 * the caller's axes. Braavos derivations are only ever recoveries, so the
 * family maps unconditionally — index 0 is identical on both axes, the only
 * coordinate any earlier release could have stored.
 */
export const bip44Axes = (
  accountContractType: AccountContractType,
  accountIndex: number,
  addressIndex: number,
): { readonly accountIndex: number; readonly addressIndex: number } =>
  accountContractType === "braavos"
    ? { accountIndex: 0, addressIndex: accountIndex + addressIndex }
    : { accountIndex, addressIndex };

/**
 * Ready's ETH-seeded scheme (issue 505): x-only keys on the address axis,
 * valid only for Argent, never under a passphrase (the vendor supports none).
 * Returns public metadata plus the private key bound for the encrypted vault;
 * every guard fails closed.
 */
export const deriveArgentXAccount = async (
  kms: KmsPort,
  input: AccountDerivationInput,
  context: {
    readonly accountIndex: number;
    readonly addressIndex: number;
    readonly networkId: StarknetNetworkId;
    readonly resolvedClassHash: string;
  },
): Promise<AccountDerivationResult> => {
  const { accountIndex, addressIndex, networkId, resolvedClassHash } = context;
  if (input.accountContractType !== "argent") {
    throw new WalletError("Ready derivation is only valid for Argent accounts");
  }
  if (input.mnemonicPassphrase !== undefined && input.mnemonicPassphrase !== "") {
    throw new WalletError("Ready derivation does not take a passphrase");
  }
  if (addressIndex !== 0) {
    throw new WalletError("Invalid derivation index");
  }
  const xOnly = canonicalXOnlyKeypair(
    await kms.deriveArgentLegacyKeypair(input.mnemonic, accountIndex),
  );
  const { address, classHash, deploymentSalt } = await deriveAccountContractAddress(kms, {
    classHash: resolvedClassHash,
    accountContractType: input.accountContractType,
    ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
    networkId,
    publicKeyX: xOnly.publicKeyX,
  });
  return {
    account: {
      ...recordContract(input.accountContractType, deploymentSalt),
      address,
      classHash,
      derivation: {
        addressIndex: accountIndex,
        kind: "argentx-bip44",
        ...(input.seedId === undefined ? {} : { seedId: input.seedId }),
      },
      id: `${networkId}:${address}`,
      networkId,
      publicKeyX: xOnly.publicKeyX,
    },
    privateKey: xOnly.privateKey,
  };
};
