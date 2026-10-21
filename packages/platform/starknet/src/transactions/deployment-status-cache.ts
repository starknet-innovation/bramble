/**
 * Deployment-status reads that briefly remember a "deployed" answer.
 *
 * Every deployment-status read is one `starknet_getClassHashAt`, and the
 * background repeats it for the same address on each Home refresh, fee review,
 * approval and recovery rescan. A Starknet contract cannot be removed from its
 * address, so "deployed" is reused for a short window once a node has said it;
 * "not deployed" can change with the account's next transaction, so it is never
 * remembered and a Retry still reads the chain again (Sherlock 218).
 *
 * The window, and skipping local nodes, exist for the cases where "deployed"
 * can stop being true: a devnet reset under the same URL, or a reorg of the
 * latest block. A local node is never remembered; anything else is read again
 * once its answer is older than `freshForMs`.
 *
 * Only that existence answer is kept. The class hash an account runs can change
 * through an upgrade, and the signing-path compatibility checks read it live at
 * a pinned block (`account-compatibility`) without going through this cache.
 */
import { isLoopbackServiceUrl } from "@bramble/core/service-url";
import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import type { DeploymentStatusInput } from "./deployment";

/** The deployment-status read this cache wraps. */
type DeploymentStatusRead = (input: DeploymentStatusInput) => Promise<boolean>;

/** Tuning and clock seams for {@link rememberDeployedAccounts}. */
export type DeployedAccountMemoryOptions = {
  /** Most addresses held at once; the oldest is dropped first. */
  readonly capacity?: number;
  /** How long a "deployed" answer is reused before the chain is read again. */
  readonly freshForMs?: number;
  /** Monotonic milliseconds; injected so tests control the freshness window's clock. */
  readonly now?: () => number;
};

// Far above the accounts one wallet holds, so in practice nothing is evicted;
// the bound only stops an endpoint that answers "deployed" to every recovery
// probe from growing the map without limit.
const DEPLOYED_ACCOUNT_CAPACITY = 512;

// Longer than the side panel's 60-second refresh, so a Home poll usually reuses
// the last answer, and short enough that a reset remote devnet or a reorg is
// seen again within minutes rather than for the worker's lifetime.
const DEPLOYED_ANSWER_FRESH_MS = 5 * 60_000;

// The same address is a different account on each network, and an answer one
// endpoint list gave is not reused once the user configures another, so the key
// is the canonical address together with the exact endpoint list it was read from.
// Only an address the reader itself accepts gets a key, so a spelling it would
// refuse (decimal, uppercase, zero) can never be answered from memory instead;
// and a list that reaches a local node gets none, since its chain can be reset.
const deployedKey = ({ accountAddress, rpcUrls }: DeploymentStatusInput): string | null =>
  isNonZeroStarkFieldElement(accountAddress) && !rpcUrls.some(isLoopbackServiceUrl)
    ? JSON.stringify([canonicalFelt(accountAddress), ...rpcUrls])
    : null;

/**
 * Wraps a deployment-status read so an address a node has reported deployed is
 * answered from memory for `freshForMs` afterwards, per endpoint list.
 * Undeployed answers and failures always reach `read` and are never stored; an
 * address `read` would refuse, and any endpoint list that includes a loopback
 * node, always pass through. The map lives as long as the returned function
 * (one background worker), is never persisted, and holds at most `capacity`
 * addresses, dropping the oldest first.
 */
export const rememberDeployedAccounts = (
  read: DeploymentStatusRead,
  {
    capacity = DEPLOYED_ACCOUNT_CAPACITY,
    freshForMs = DEPLOYED_ANSWER_FRESH_MS,
    now = () => performance.now(),
  }: DeployedAccountMemoryOptions = {},
): DeploymentStatusRead => {
  // Key -> when the node said "deployed". Insertion order is age, so the first
  // entry is the one to let go.
  const deployedAt = new Map<string, number>();
  const isFresh = (key: string): boolean => {
    const at = deployedAt.get(key);
    return at !== undefined && now() - at < freshForMs;
  };
  const remember = (key: string): void => {
    deployedAt.delete(key);
    const oldest = deployedAt.size >= capacity ? deployedAt.keys().next().value : undefined;
    if (oldest !== undefined) {
      deployedAt.delete(oldest);
    }
    deployedAt.set(key, now());
  };
  return async (input) => {
    const key = deployedKey(input);
    if (key !== null && isFresh(key)) {
      return true;
    }
    const isDeployed = await read(input);
    if (key !== null) {
      if (isDeployed) {
        remember(key);
      } else {
        deployedAt.delete(key);
      }
    }
    return isDeployed;
  };
};
