/**
 * Strict parsers for privileged Argent multisig runtime messages.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import {
  type ArgentMultisigCall,
  isArgentMultisigCalls,
  MULTISIG_LIMITS,
} from "@bramble/multisig/chain";
import {
  type ArgentMultisigDeployConfig,
  canonicalArgentMultisigDeployConfig,
} from "@bramble/multisig/deploy";
import {
  type ArgentMultisigSigningIntent,
  isArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { type FeeEstimate, isFeeEstimate } from "@bramble/starknet/fee-bounds";
import type { FeeAffordability } from "@bramble/transactions/fee-funds";
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import type { StarkSignature } from "@bramble/wallet-model/signing";

const isCanonicalNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) && canonicalFelt(value) === value;

const isName = (value: unknown): value is string | undefined =>
  value === undefined ||
  (typeof value === "string" &&
    value.length > 0 &&
    value.length <= MULTISIG_LIMITS.nameLength &&
    value.trim() === value);

type NormalizedArgentMultisigCall = {
  readonly calldata: string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

/**
 * Copies validated frozen calls into Starknet.js's mutable calldata shape.
 * This projection adds no authority and cannot fail.
 */
export const normalizedArgentMultisigCalls = (
  calls: ArgentMultisigSigningIntent["prepared"]["calls"],
): readonly NormalizedArgentMultisigCall[] =>
  calls.map((call) => ({ ...call, calldata: [...call.calldata] }));

const isDeployFields = (value: Record<string, unknown>): boolean => {
  if (
    typeof value["salt"] !== "string" ||
    !Array.isArray(value["signerPublicKeys"]) ||
    !value["signerPublicKeys"].every((key) => typeof key === "string") ||
    !Number.isSafeInteger(value["threshold"])
  ) {
    return false;
  }
  try {
    canonicalArgentMultisigDeployConfig({
      salt: value["salt"],
      signerPublicKeys: value["signerPublicKeys"] as readonly string[],
      threshold: Number(value["threshold"]),
    });
    return true;
  } catch {
    return false;
  }
};

const deployConfigFrom = (value: Record<string, unknown>): ArgentMultisigDeployConfig =>
  canonicalArgentMultisigDeployConfig({
    salt: value["salt"] as string,
    signerPublicKeys: value["signerPublicKeys"] as readonly string[],
    threshold: Number(value["threshold"]),
  });

/**
 * Parsed current-chain account registration request.
 */
export type AddArgentMultisigInput = {
  readonly address: string;
  readonly networkId: StarknetNetworkId;
  readonly signerPublicKeys?: readonly string[];
};

/**
 * Parses address-only discovery for an existing pinned account.
 */
export const readAddMultisigInput = (message: unknown): AddArgentMultisigInput | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["address", "networkId", "signerPublicKeys", "type"]) ||
    message["type"] !== "wallet.addMultisig" ||
    !isStarknetNetworkId(message["networkId"]) ||
    !isCanonicalNonZeroFelt(message["address"]) ||
    (message["signerPublicKeys"] !== undefined &&
      (!Array.isArray(message["signerPublicKeys"]) ||
        message["signerPublicKeys"].length === 0 ||
        message["signerPublicKeys"].length > MULTISIG_LIMITS.signers ||
        !message["signerPublicKeys"].every(isCanonicalNonZeroFelt)))
  ) {
    return null;
  }
  return {
    address: message["address"],
    networkId: message["networkId"],
    ...(message["signerPublicKeys"] === undefined
      ? {}
      : { signerPublicKeys: message["signerPublicKeys"] as readonly string[] }),
  };
};

/**
 * Parses one wallet-only request to resolve a supported participant account.
 */
export const readResolveMultisigSignerInput = (
  message: unknown,
): { readonly address: string; readonly networkId: StarknetNetworkId } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["address", "networkId", "type"]) &&
  message["type"] === "wallet.resolveMultisigSigner" &&
  isStarknetNetworkId(message["networkId"]) &&
  isCanonicalNonZeroFelt(message["address"])
    ? { address: message["address"], networkId: message["networkId"] }
    : null;

/**
 * Parses an exact multisig id request.
 */
export const readMultisigIdInput = (
  message: unknown,
  type: "wallet.multisigBalances" | "wallet.refreshMultisig" | "wallet.syncArgentMultisigIntents",
): { readonly multisigId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["multisigId", "type"]) &&
  message["type"] === type &&
  isAccountId(message["multisigId"])
    ? { multisigId: message["multisigId"] }
    : null;

/**
 * Parses a multisig balance read, optionally from the durable snapshot.
 */
export const readMultisigBalancesInput = (
  message: unknown,
): { readonly cached: boolean; readonly multisigId: string; readonly refresh: boolean } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["cached", "multisigId", "refresh", "type"]) &&
  message["type"] === "wallet.multisigBalances" &&
  isAccountId(message["multisigId"]) &&
  (message["cached"] === undefined || message["cached"] === true) &&
  (message["refresh"] === undefined || message["refresh"] === true) &&
  !(message["cached"] === true && message["refresh"] === true)
    ? {
        cached: message["cached"] === true,
        multisigId: message["multisigId"],
        refresh: message["refresh"] === true,
      }
    : null;

/**
 * Parses the watched-multisig reader's optional stored-snapshot request.
 */
export const readMultisigsInput = (message: unknown): { readonly cached: boolean } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["cached", "type"]) &&
  message["type"] === "wallet.multisigs" &&
  (message["cached"] === undefined || message["cached"] === true)
    ? { cached: message["cached"] === true }
    : null;

/**
 * Parses account removal, with an explicit terminal-history acknowledgement.
 */
export const readRemoveMultisigInput = (
  message: unknown,
): { readonly confirmHistoryRemoval: boolean; readonly multisigId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["confirmHistoryRemoval", "multisigId", "type"]) &&
  message["type"] === "wallet.removeMultisig" &&
  isAccountId(message["multisigId"]) &&
  (message["confirmHistoryRemoval"] === undefined || message["confirmHistoryRemoval"] === true)
    ? {
        confirmHistoryRemoval: message["confirmHistoryRemoval"] === true,
        multisigId: message["multisigId"],
      }
    : null;

/**
 * Parses preparation of one exact call batch.
 */
export const readPrepareIntentInput = (
  message: unknown,
): {
  readonly calls: readonly ArgentMultisigCall[];
  readonly multisigId: string;
} | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["calls", "multisigId", "type"]) &&
  message["type"] === "wallet.prepareArgentMultisigIntent" &&
  isAccountId(message["multisigId"]) &&
  isArgentMultisigCalls(message["calls"])
    ? {
        calls: message["calls"],
        multisigId: message["multisigId"],
      }
    : null;

/**
 * Parses local signing by one explicitly selected wallet account.
 */
export const readSignIntentInput = (
  message: unknown,
): { readonly intentId: string; readonly signerAccountId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["intentId", "signerAccountId", "type"]) &&
  message["type"] === "wallet.signArgentMultisigIntent" &&
  typeof message["intentId"] === "string" &&
  message["intentId"].length > 0 &&
  isAccountId(message["signerAccountId"])
    ? { intentId: message["intentId"], signerAccountId: message["signerAccountId"] }
    : null;

const isSignature = (value: unknown): value is StarkSignature =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["publicKey", "r", "s"]) &&
  isCanonicalNonZeroFelt(value["publicKey"]) &&
  isCanonicalNonZeroFelt(value["r"]) &&
  isCanonicalNonZeroFelt(value["s"]);

/**
 * Parses one externally collected signature fragment.
 */
export const readImportIntentSignatureInput = (
  message: unknown,
): { readonly intentId: string; readonly signature: StarkSignature } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["intentId", "signature", "type"]) &&
  message["type"] === "wallet.importArgentMultisigSignature" &&
  typeof message["intentId"] === "string" &&
  message["intentId"].length > 0 &&
  isSignature(message["signature"])
    ? { intentId: message["intentId"], signature: message["signature"] }
    : null;

/**
 * Versioned deterministic package exchanged between independent co-signers.
 */
export type ArgentMultisigIntentPackage = {
  readonly intent: ArgentMultisigSigningIntent;
  readonly kind: "bramble.argent-multisig-intent";
  readonly version: 1;
};

/**
 * Builds the only full-intent package version this runtime exports.
 */
export const argentMultisigIntentPackage = (
  intent: ArgentMultisigSigningIntent,
): ArgentMultisigIntentPackage => ({
  intent,
  kind: "bramble.argent-multisig-intent",
  version: 1,
});

/**
 * Discards untrusted remote lifecycle claims and derives local authority only
 * from already-validated signature count. This pure projection never throws.
 */
export const locallyDerivedImportedIntent = (
  intent: ArgentMultisigSigningIntent,
): ArgentMultisigSigningIntent => {
  const { broadcastTransactionHash: _remoteBroadcast, ...imported } = intent;
  return {
    ...imported,
    state:
      imported.signatures.length === imported.configSnapshot.threshold ? "ready" : "collecting",
  };
};

/**
 * Orders verified signature fragments in Argent's canonical signer order.
 */
export const sortedArgentMultisigSignatures = (
  values: readonly StarkSignature[],
): readonly StarkSignature[] =>
  [...values].sort((left, right) =>
    BigInt(argentSignerGuid(left.publicKey)) < BigInt(argentSignerGuid(right.publicKey)) ? -1 : 1,
  );

/**
 * Merges a re-import of the same frozen hash without regressing local state.
 * Terminal local outcomes remain authoritative; open intents gain only new,
 * already-validated signer fragments.
 */
export const mergeImportedArgentMultisigIntent = (
  current: ArgentMultisigSigningIntent,
  incoming: ArgentMultisigSigningIntent,
): ArgentMultisigSigningIntent => {
  if (current.state !== "collecting" && current.state !== "ready") return current;
  const signatures = [...current.signatures];
  for (const signature of incoming.signatures) {
    if (!signatures.some((stored) => stored.publicKey === signature.publicKey)) {
      signatures.push(signature);
    }
  }
  const sorted = sortedArgentMultisigSignatures(signatures);
  return {
    ...incoming,
    signatures: sorted,
    state: sorted.length === incoming.configSnapshot.threshold ? "ready" : "collecting",
  };
};

/**
 * Parses a full frozen intent package without normalizing any signed field.
 */
export const readImportIntentInput = (
  message: unknown,
): { readonly package: ArgentMultisigIntentPackage } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["package", "type"]) ||
    message["type"] !== "wallet.importArgentMultisigIntent" ||
    !isRecord(message["package"]) ||
    !hasOnlyKnownKeys(message["package"], ["intent", "kind", "version"]) ||
    message["package"]["kind"] !== "bramble.argent-multisig-intent" ||
    message["package"]["version"] !== 1 ||
    !isArgentMultisigSigningIntent(message["package"]["intent"])
  ) {
    return null;
  }
  return { package: message["package"] as unknown as ArgentMultisigIntentPackage };
};

/**
 * Parses submission of one stored, immutable signing intent.
 */
export const readSubmitIntentInput = (message: unknown): { readonly intentId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["intentId", "type"]) &&
  message["type"] === "wallet.submitArgentMultisigIntent" &&
  typeof message["intentId"] === "string" &&
  message["intentId"].length > 0
    ? { intentId: message["intentId"] }
    : null;

/**
 * Parses deletion of one exact locally stored intent.
 */
export const readRemoveIntentInput = (message: unknown): { readonly intentId: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["intentId", "type"]) &&
  message["type"] === "wallet.removeArgentMultisigIntent" &&
  typeof message["intentId"] === "string" &&
  message["intentId"].length > 0 &&
  message["intentId"].length <= 256
    ? { intentId: message["intentId"] }
    : null;

/**
 * Exact deployment review echoed from review to submit.
 */
export type ArgentMultisigDeploymentReview = ArgentMultisigDeployConfig & {
  readonly address: string;
  readonly fee: FeeEstimate;
  readonly feeAffordability: FeeAffordability;
  readonly name?: string;
  readonly networkId: StarknetNetworkId;
  readonly signerAccountId: string;
};

const readDeploymentReview = (value: unknown): ArgentMultisigDeploymentReview | null => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "address",
      "fee",
      "feeAffordability",
      "name",
      "networkId",
      "salt",
      "signerAccountId",
      "signerPublicKeys",
      "threshold",
    ]) ||
    !isCanonicalNonZeroFelt(value["address"]) ||
    !isFeeEstimate(value["fee"]) ||
    (value["feeAffordability"] !== "insufficient" &&
      value["feeAffordability"] !== "ok" &&
      value["feeAffordability"] !== "unknown") ||
    !isName(value["name"]) ||
    !isStarknetNetworkId(value["networkId"]) ||
    !isAccountId(value["signerAccountId"]) ||
    !isDeployFields(value)
  ) {
    return null;
  }
  return {
    address: value["address"],
    ...deployConfigFrom(value),
    fee: value["fee"],
    feeAffordability: value["feeAffordability"],
    ...(value["name"] === undefined ? {} : { name: value["name"] }),
    networkId: value["networkId"],
    signerAccountId: value["signerAccountId"],
  };
};

/**
 * Parses a constructor and signer selection for fee review.
 */
export const readReviewDeploymentInput = (
  message: unknown,
):
  | (Omit<ArgentMultisigDeploymentReview, "address" | "fee" | "feeAffordability"> & {
      readonly expectedAddress?: string;
    })
  | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, [
      "name",
      "networkId",
      "expectedAddress",
      "salt",
      "signerAccountId",
      "signerPublicKeys",
      "threshold",
      "type",
    ]) ||
    message["type"] !== "wallet.reviewArgentMultisigDeployment" ||
    (message["expectedAddress"] !== undefined &&
      !isCanonicalNonZeroFelt(message["expectedAddress"])) ||
    !isName(message["name"]) ||
    !isStarknetNetworkId(message["networkId"]) ||
    !isAccountId(message["signerAccountId"]) ||
    !isDeployFields(message)
  ) {
    return null;
  }
  return {
    ...deployConfigFrom(message),
    ...(message["expectedAddress"] === undefined
      ? {}
      : { expectedAddress: message["expectedAddress"] }),
    ...(message["name"] === undefined ? {} : { name: message["name"] }),
    networkId: message["networkId"],
    signerAccountId: message["signerAccountId"],
  };
};

/**
 * Parses a deployment only when the exact prior review is echoed.
 */
export const readDeployMultisigInput = (
  message: unknown,
): { readonly review: ArgentMultisigDeploymentReview } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["review", "type"]) ||
    message["type"] !== "wallet.deployArgentMultisig"
  ) {
    return null;
  }
  const review = readDeploymentReview(message["review"]);
  return review ? { review } : null;
};
