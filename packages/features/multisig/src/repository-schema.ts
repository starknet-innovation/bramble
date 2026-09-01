/**
 * Pure record shapes and strict browser-storage validators for Argent multisig.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import { isArgentMultisigCalls, MULTISIG_LIMITS } from "@mc-wallet/multisig/chain";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentMultisigAddress,
  argentSignerGuid,
  normalizeArgentMultisigConfig,
} from "@mc-wallet/starknet/account-contracts";
import {
  isPreparedArgentMultisigInvokeV3,
  type PreparedArgentMultisigInvokeV3,
  samePreparedArgentMultisigInvokeV3,
} from "@mc-wallet/starknet/multisig-invoke";
import { verifyStarkSignature } from "@mc-wallet/starknet/signature-verify";
import { isAccountId } from "@mc-wallet/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  isStarknetNetworkId,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";

/**
 * Counterfactual constructor commitment retained for an account created here.
 */
type ArgentMultisigDeployment = {
  readonly salt: string;
  readonly signerPublicKeys: readonly string[];
  readonly threshold: number;
};

/**
 * Last chain-observed public signer configuration. This is mutable authority,
 * kept separate from the immutable counterfactual deployment commitment.
 */
export type ArgentMultisigCurrentConfig = {
  readonly signerPublicKeys: readonly string[];
  readonly threshold: number;
};

/**
 * Pinned shared-account metadata kept outside the single-signer vault.
 */
export type ArgentMultisigRecord = {
  readonly accountContractType: "argent-multisig";
  readonly address: string;
  readonly classHash: string;
  readonly currentConfig?: ArgentMultisigCurrentConfig;
  readonly deployment?: ArgentMultisigDeployment;
  readonly id: string;
  readonly name?: string;
  readonly networkId: StarknetNetworkId;
};

/**
 * Fresh class and signer authority bound to a frozen signing intent.
 */
export type ArgentMultisigConfigSnapshot = {
  readonly classHash: string;
  readonly signerGuids: readonly string[];
  readonly threshold: number;
};

/**
 * Lifecycle of one locally collected exact-hash signature set.
 */
export type ArgentMultisigIntentState =
  | "accepted"
  | "collecting"
  | "ready"
  | "rejected"
  | "stale"
  | "submitted";

/**
 * One frozen V3 transaction and its verified Starknet-key signature fragments.
 * The platform guard re-computes `prepared.transactionHash`; this package never
 * implements Starknet transaction hashing itself.
 */
export type ArgentMultisigSigningIntent = {
  readonly accountId: string;
  readonly broadcastTransactionHash?: string;
  readonly configSnapshot: ArgentMultisigConfigSnapshot;
  readonly id: string;
  readonly prepared: PreparedArgentMultisigInvokeV3;
  readonly signatures: readonly StarkSignature[];
  readonly state: ArgentMultisigIntentState;
  readonly summary: string;
};

/**
 * Durable deduplication claim written before signing or network mutation.
 */
export type ArgentMultisigOperationRecord = {
  readonly accountId: string;
  readonly id: string;
  readonly kind: "deploy" | "sign" | "submit";
  readonly signerGuid?: string;
  readonly target: string;
  readonly transactionHash?: string;
};

const ACCOUNT_KEYS = [
  "accountContractType",
  "address",
  "classHash",
  "currentConfig",
  "deployment",
  "id",
  "name",
  "networkId",
] as const;

const canonicalNonZeroFelt = (value: unknown): value is string =>
  typeof value === "string" && isNonZeroStarkFieldElement(value) && canonicalFelt(value) === value;

const isCanonicalFelt = (value: unknown): value is string =>
  typeof value === "string" && canonicalFelt(value) === value;

/**
 * Strictly validates canonical ordered public signer configuration.
 */
export const isArgentMultisigCurrentConfig = (
  value: unknown,
): value is ArgentMultisigCurrentConfig => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["signerPublicKeys", "threshold"]) ||
    !Array.isArray(value["signerPublicKeys"]) ||
    !value["signerPublicKeys"].every((key) => typeof key === "string") ||
    !Number.isSafeInteger(value["threshold"])
  ) {
    return false;
  }
  try {
    const keys = value["signerPublicKeys"] as string[];
    const normalized = normalizeArgentMultisigConfig({
      signerPublicKeys: keys,
      threshold: Number(value["threshold"]),
    });
    return normalized.signerPublicKeys.every((key, index) => key === keys[index]);
  } catch {
    return false;
  }
};

const isDeployment = (value: unknown): value is ArgentMultisigDeployment =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["salt", "signerPublicKeys", "threshold"]) &&
  isCanonicalFelt(value["salt"]) &&
  isArgentMultisigCurrentConfig({
    signerPublicKeys: value["signerPublicKeys"],
    threshold: value["threshold"],
  });

const deploymentMatchesAddress = (
  deployment: ArgentMultisigDeployment | undefined,
  address: string,
): boolean => {
  if (!deployment) {
    return true;
  }
  try {
    return sameFelt(
      argentMultisigAddress(
        {
          signerPublicKeys: deployment.signerPublicKeys,
          threshold: deployment.threshold,
        },
        deployment.salt,
      ),
      address,
    );
  } catch {
    return false;
  }
};

/**
 * Strictly validates one watched stable Argent multisig account.
 */
export const isArgentMultisigRecord = (value: unknown): value is ArgentMultisigRecord => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ACCOUNT_KEYS) ||
    (value["name"] !== undefined &&
      (typeof value["name"] !== "string" ||
        value["name"].length === 0 ||
        value["name"].length > MULTISIG_LIMITS.nameLength))
  ) {
    return false;
  }
  return (
    value["accountContractType"] === "argent-multisig" &&
    canonicalNonZeroFelt(value["address"]) &&
    value["classHash"] === ARGENT_MULTISIG_CONTRACT.classHash &&
    isStarknetNetworkId(value["networkId"]) &&
    value["id"] === `${value["networkId"]}:${value["address"]}` &&
    (value["currentConfig"] === undefined ||
      isArgentMultisigCurrentConfig(value["currentConfig"])) &&
    (value["deployment"] === undefined || isDeployment(value["deployment"])) &&
    deploymentMatchesAddress(
      value["deployment"] as ArgentMultisigDeployment | undefined,
      value["address"],
    )
  );
};

/**
 * Builds the deterministic intent id from shared account and prepared hash.
 */
export const argentMultisigIntentId = (
  accountId: string,
  transactionHash: string,
): string | null => {
  const hash = canonicalFelt(transactionHash);
  return isAccountId(accountId) && hash !== null ? `${accountId}:${hash}` : null;
};

/**
 * Builds a durable operation id, scoped by signer GUID only for signing.
 */
export const argentMultisigOperationId = (
  kind: ArgentMultisigOperationRecord["kind"],
  accountId: string,
  target: string,
  signerGuid?: string,
): string | null => {
  const canonicalTarget = canonicalFelt(target);
  if (!isAccountId(accountId) || canonicalTarget === null) {
    return null;
  }
  if (kind === "sign") {
    const canonicalGuid = canonicalFelt(signerGuid ?? "");
    return canonicalGuid !== null && BigInt(canonicalGuid) !== 0n
      ? `${kind}:${accountId}:${canonicalTarget}:${canonicalGuid}`
      : null;
  }
  return signerGuid === undefined ? `${kind}:${accountId}:${canonicalTarget}` : null;
};

const isConfigSnapshot = (value: unknown): value is ArgentMultisigConfigSnapshot => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["classHash", "signerGuids", "threshold"]) ||
    value["classHash"] !== ARGENT_MULTISIG_CONTRACT.classHash ||
    !Array.isArray(value["signerGuids"]) ||
    value["signerGuids"].length === 0 ||
    value["signerGuids"].length > MULTISIG_LIMITS.signers ||
    !Number.isSafeInteger(value["threshold"]) ||
    Number(value["threshold"]) < 1 ||
    Number(value["threshold"]) > value["signerGuids"].length
  ) {
    return false;
  }
  const guids = value["signerGuids"];
  return guids.every(
    (guid, index) =>
      canonicalNonZeroFelt(guid) &&
      (index === 0 || BigInt(guids[index - 1] as string) < BigInt(guid)),
  );
};

const isSignatureShape = (value: unknown): value is StarkSignature =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["publicKey", "r", "s"]) &&
  canonicalNonZeroFelt(value["publicKey"]) &&
  canonicalNonZeroFelt(value["r"]) &&
  canonicalNonZeroFelt(value["s"]);

const areValidSignatures = (
  values: unknown,
  config: ArgentMultisigConfigSnapshot,
  transactionHash: string,
): values is readonly StarkSignature[] => {
  if (
    !Array.isArray(values) ||
    values.length > config.threshold ||
    !values.every(isSignatureShape)
  ) {
    return false;
  }
  const members = new Set(config.signerGuids);
  let priorGuid = 0n;
  for (const signature of values) {
    const guid = argentSignerGuid(signature.publicKey);
    if (
      !members.has(guid) ||
      BigInt(guid) <= priorGuid ||
      !verifyStarkSignature({
        hash: transactionHash,
        publicKeyX: signature.publicKey,
        signature: { r: signature.r, s: signature.s },
      })
    ) {
      return false;
    }
    priorGuid = BigInt(guid);
  }
  return true;
};

const accountScopeMatchesPrepared = (
  accountId: string,
  prepared: PreparedArgentMultisigInvokeV3,
): boolean => {
  const [networkId, address] = accountId.split(":");
  return (
    isStarknetNetworkId(networkId) &&
    typeof address === "string" &&
    sameFelt(address, prepared.senderAddress) &&
    sameFelt(STARKNET_NETWORKS[networkId].chainId, prepared.chainId) &&
    isArgentMultisigCalls(prepared.calls)
  );
};

const hasStateConsistentAuthority = (intent: ArgentMultisigSigningIntent): boolean => {
  const count = intent.signatures.length;
  const threshold = intent.configSnapshot.threshold;
  const broadcast = intent.broadcastTransactionHash;
  if (intent.state === "collecting") {
    return count < threshold && broadcast === undefined;
  }
  if (intent.state === "ready") {
    return count === threshold && broadcast === undefined;
  }
  if (intent.state === "stale") {
    return count <= threshold && broadcast === undefined;
  }
  return (
    count === threshold &&
    canonicalNonZeroFelt(broadcast) &&
    sameFelt(broadcast, intent.prepared.transactionHash)
  );
};

/**
 * Strictly validates a stored intent, including platform hash re-derivation,
 * account/chain scope, signer membership/order, and every signature.
 */
export const isArgentMultisigSigningIntent = (
  value: unknown,
): value is ArgentMultisigSigningIntent => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "accountId",
      "broadcastTransactionHash",
      "configSnapshot",
      "id",
      "prepared",
      "signatures",
      "state",
      "summary",
    ]) ||
    !isAccountId(value["accountId"]) ||
    !isConfigSnapshot(value["configSnapshot"]) ||
    !isPreparedArgentMultisigInvokeV3(value["prepared"]) ||
    typeof value["summary"] !== "string" ||
    value["summary"].length === 0 ||
    value["summary"].length > MULTISIG_LIMITS.summaryLength ||
    value["summary"].trim() !== value["summary"] ||
    !["accepted", "collecting", "ready", "rejected", "stale", "submitted"].includes(
      String(value["state"]),
    )
  ) {
    return false;
  }
  const intent = value as unknown as ArgentMultisigSigningIntent;
  return (
    intent.id === argentMultisigIntentId(intent.accountId, intent.prepared.transactionHash) &&
    accountScopeMatchesPrepared(intent.accountId, intent.prepared) &&
    areValidSignatures(intent.signatures, intent.configSnapshot, intent.prepared.transactionHash) &&
    hasStateConsistentAuthority(intent)
  );
};

const sameConfigSnapshot = (
  left: ArgentMultisigConfigSnapshot,
  right: ArgentMultisigConfigSnapshot,
): boolean =>
  left.classHash === right.classHash &&
  left.threshold === right.threshold &&
  left.signerGuids.length === right.signerGuids.length &&
  left.signerGuids.every((guid, index) => guid === right.signerGuids[index]);

const sameSignature = (left: StarkSignature, right: StarkSignature): boolean =>
  left.publicKey === right.publicKey && left.r === right.r && left.s === right.s;

const validStateTransition = (
  current: ArgentMultisigIntentState,
  next: ArgentMultisigIntentState,
): boolean => {
  const allowed: Readonly<Record<ArgentMultisigIntentState, readonly ArgentMultisigIntentState[]>> =
    {
      accepted: ["accepted"],
      collecting: ["collecting", "ready", "stale"],
      ready: ["accepted", "ready", "rejected", "stale", "submitted"],
      rejected: ["rejected"],
      stale: ["stale", "submitted"],
      submitted: ["accepted", "rejected", "submitted"],
    };
  return allowed[current].includes(next);
};

/**
 * Allows only monotonic signature collection and lifecycle transitions while
 * keeping every reviewed/hash-bound field immutable.
 */
export const canReplaceArgentMultisigSigningIntent = (
  current: ArgentMultisigSigningIntent,
  next: ArgentMultisigSigningIntent,
): boolean =>
  isArgentMultisigSigningIntent(current) &&
  isArgentMultisigSigningIntent(next) &&
  current.accountId === next.accountId &&
  current.id === next.id &&
  current.summary === next.summary &&
  sameConfigSnapshot(current.configSnapshot, next.configSnapshot) &&
  samePreparedArgentMultisigInvokeV3(current.prepared, next.prepared) &&
  current.signatures.every((signature) =>
    next.signatures.some((candidate) => sameSignature(signature, candidate)),
  ) &&
  validStateTransition(current.state, next.state);

/**
 * Strictly validates one durable operation claim and its deterministic id.
 */
export const isArgentMultisigOperationRecord = (
  value: unknown,
): value is ArgentMultisigOperationRecord => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, [
      "accountId",
      "id",
      "kind",
      "signerGuid",
      "target",
      "transactionHash",
    ]) ||
    !isAccountId(value["accountId"]) ||
    (value["kind"] !== "deploy" && value["kind"] !== "sign" && value["kind"] !== "submit") ||
    !canonicalNonZeroFelt(value["target"])
  ) {
    return false;
  }
  if (
    value["kind"] === "sign"
      ? !canonicalNonZeroFelt(value["signerGuid"]) || value["transactionHash"] !== undefined
      : value["signerGuid"] !== undefined ||
        (value["transactionHash"] !== undefined &&
          (!canonicalNonZeroFelt(value["transactionHash"]) ||
            (value["kind"] === "submit" && !sameFelt(value["transactionHash"], value["target"]))))
  ) {
    return false;
  }
  return (
    value["id"] ===
    argentMultisigOperationId(
      value["kind"],
      value["accountId"],
      value["target"],
      typeof value["signerGuid"] === "string" ? value["signerGuid"] : undefined,
    )
  );
};
