/**
 * Deployment-status reads that remember a "deployed" answer.
 *
 * Every deployment-status read is one `starknet_getClassHashAt`, and the
 * background repeats it for the same address on each Home refresh, fee review,
 * approval and recovery rescan. A Starknet contract cannot be removed from its
 * address, so "deployed" stays true once a node has said it; "not deployed"
 * can change with the account's next transaction, so it is never remembered and
 * a Retry still reads the chain again (Sherlock 218).
 *
 * Only that existence answer is kept. The class hash an account runs can change
 * through an upgrade, and the signing-path compatibility checks read it live at
 * a pinned block (`account-compatibility`) without going through this cache.
 */
import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import type { DeploymentStatusInput } from "./deployment";

/** The deployment-status read this cache wraps. */
type DeploymentStatusRead = (input: DeploymentStatusInput) => Promise<boolean>;

// Far above the accounts one wallet holds, so in practice nothing is evicted;
// the bound only stops an endpoint that answers "deployed" to every recovery
// probe from growing the set without limit.
const DEPLOYED_ACCOUNT_CAPACITY = 512;

// The same address is a different account on each network, and an answer one
// endpoint list gave is not reused once the user configures another, so the key
// is the canonical address together with the exact endpoint list it was read from.
// Only an address the reader itself accepts gets a key, so a spelling it would
// refuse (decimal, uppercase, zero) can never be answered from memory instead.
const deployedKey = ({ accountAddress, rpcUrls }: DeploymentStatusInput): string | null =>
  isNonZeroStarkFieldElement(accountAddress)
    ? JSON.stringify([canonicalFelt(accountAddress), ...rpcUrls])
    : null;

/**
 * Wraps a deployment-status read so an address a node has reported deployed is
 * answered from memory afterwards, per endpoint list. Undeployed answers and
 * failures always reach `read` and are never stored, and an address `read`
 * would refuse is always passed through for it to refuse. The set lives as
 * long as the returned function (one background worker), is never persisted,
 * and holds at most `capacity` addresses, dropping the oldest first.
 */
export const rememberDeployedAccounts = (
  read: DeploymentStatusRead,
  capacity = DEPLOYED_ACCOUNT_CAPACITY,
): DeploymentStatusRead => {
  const deployed = new Set<string>();
  // Insertion order is age, so the first entry is the one to let go.
  const remember = (key: string): void => {
    const oldest = deployed.size >= capacity ? deployed.values().next().value : undefined;
    if (oldest !== undefined) {
      deployed.delete(oldest);
    }
    deployed.add(key);
  };
  return async (input) => {
    const key = deployedKey(input);
    if (key !== null && deployed.has(key)) {
      return true;
    }
    const isDeployed = await read(input);
    if (isDeployed && key !== null) {
      remember(key);
    }
    return isDeployed;
  };
};
