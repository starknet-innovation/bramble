/** Public multisig view state derived from the durable local registry. */
import type {
  ArgentMultisigAuthorityStatus,
  ArgentMultisigConfig,
  ArgentUnsupportedSigner,
} from "@bramble/multisig/chain";
import type {
  ArgentMultisigOperationRecord,
  ArgentMultisigRecord,
} from "@bramble/multisig/repository";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";

/**
 * Fresh chain state paired with one public persisted shared-account record.
 */
export type ArgentMultisigView = {
  readonly authorityStatus: ArgentMultisigAuthorityStatus;
  readonly config: ArgentMultisigConfig | null;
  readonly deployed: boolean | null;
  readonly deploymentPending?: true;
  readonly record: ArgentMultisigRecord;
  readonly unsupportedSigners: readonly ArgentUnsupportedSigner[];
};

/**
 * Accounts with a known deployment hash that have not yet been observed on-chain.
 */
export const pendingDeploymentIds = (
  records: readonly ArgentMultisigOperationRecord[],
): ReadonlySet<string> =>
  new Set(
    records.flatMap((record) =>
      record.kind === "deploy" && record.transactionHash ? [record.accountId] : [],
    ),
  );

/**
 * Cached view that never offers another deployment while a known hash settles.
 */
export const storedMultisigView = (
  record: ArgentMultisigRecord,
  hasDeploymentHash = false,
): ArgentMultisigView => {
  const stored = record.currentConfig ?? record.deployment;
  const deploymentPending = hasDeploymentHash && record.currentConfig === undefined;
  let authorityStatus: ArgentMultisigAuthorityStatus = "network-unavailable";
  let deployed: boolean | null = null;
  if (record.currentConfig) {
    authorityStatus = "available";
    deployed = true;
  } else if (record.deployment) {
    authorityStatus = "undeployed";
    deployed = deploymentPending ? null : false;
  }
  return {
    authorityStatus,
    config: stored
      ? {
          classHash: record.classHash,
          signerGuids: stored.signerPublicKeys.map(argentSignerGuid),
          threshold: stored.threshold,
        }
      : null,
    deployed,
    ...(deploymentPending ? { deploymentPending: true } : {}),
    record,
    unsupportedSigners: [],
  };
};

/**
 * Unavailable fresh view without discarding a known pending deployment hash.
 */
export const unresolvedMultisigView = (
  record: ArgentMultisigRecord,
  authorityStatus: ArgentMultisigAuthorityStatus,
  deploymentPending: boolean,
): ArgentMultisigView => ({
  authorityStatus,
  config: null,
  deployed: deploymentPending ? null : authorityStatus === "undeployed" ? false : null,
  ...(deploymentPending ? { deploymentPending: true } : {}),
  record,
  unsupportedSigners: [],
});
