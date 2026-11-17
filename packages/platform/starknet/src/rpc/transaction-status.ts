/**
 * Transaction-status reads for the activity feed: one bounded, failover-aware
 * fan-out over `starknet_getTransactionStatus`, and the classifier that turns
 * an untrusted answer into a {@link TransactionStatusReport}.
 */
import type { RpcProvider } from "starknet";
import { isTransactionNotFoundError, isTransportRpcError, withRpcFallback } from "./provider";

/**
 * Inputs for reading transaction statuses.
 */
export type TransactionStatusInput = {
  readonly hashes: readonly string[];
  readonly rpcUrls: readonly string[];
};

/**
 * Chain-derived transaction status used by the activity feed.
 *
 * `preconfirmed` is Starknet's `PRE_CONFIRMED` finality: the block proposer has
 * executed the transaction in the block it is building, so its outcome
 * (including a revert) is already known, but consensus has not committed that
 * block. Provisional — a real outcome the user can act on, never final.
 * `ACCEPTED_ON_L1` and `ACCEPTED_ON_L2` both map to `accepted`; L1 finality is
 * tracked out of band (see {@link TransactionStatusReport}).
 */
export type TransactionStatus = "accepted" | "pending" | "preconfirmed" | "rejected" | "reverted";

/**
 * One hash's chain observation.
 *
 * - `found` is false only when the node answered that it has no record of the
 *   hash (`TXN_HASH_NOT_FOUND`); a transport failure fails over or throws
 *   instead, so this means "the node says it is gone", not "we could not ask".
 *   A pre-confirmed transaction whose block proposal never commits disappears
 *   exactly this way, but a single not-found is ordinary noise — callers must
 *   require several consecutive observations before treating it as failure.
 * - `finalizedOnL1` is true only for `ACCEPTED_ON_L1`: the reconciliation
 *   loop's terminal condition, deliberately not a {@link TransactionStatus}.
 * - `seen` is true only when the node returned a real finality status
 *   (`RECEIVED`, `CANDIDATE`, `PRE_CONFIRMED`, `ACCEPTED_*`, `REJECTED`) or a
 *   revert. `found` alone is not proof of a sighting: an unclassified answer or
 *   an odd RPC error is reported as found-and-pending so it never counts toward
 *   a disappearance, but it must not count as having seen the transaction
 *   either.
 */
export type TransactionStatusReport = {
  readonly finalizedOnL1: boolean;
  readonly found: boolean;
  readonly seen: boolean;
  readonly status: TransactionStatus;
};

const FINALITY_TO_STATUS: Readonly<Record<string, TransactionStatus>> = {
  ACCEPTED_ON_L1: "accepted",
  ACCEPTED_ON_L2: "accepted",
  PRE_CONFIRMED: "preconfirmed",
  REJECTED: "rejected",
};

// Finality answers that prove the node holds the transaction but do not move
// it past pending.
const SEEN_PENDING_FINALITIES: ReadonlySet<string> = new Set(["CANDIDATE", "RECEIVED"]);

// Unclassified answers and non-transport RPC errors deliberately stay pending,
// unseen: they say nothing about whether the node knows the hash.
const PENDING_REPORT: TransactionStatusReport = {
  finalizedOnL1: false,
  found: true,
  seen: false,
  status: "pending",
};
const SEEN_PENDING_REPORT: TransactionStatusReport = { ...PENDING_REPORT, seen: true };
const NOT_FOUND_REPORT: TransactionStatusReport = {
  finalizedOnL1: false,
  found: false,
  seen: false,
  status: "pending",
};

/**
 * Maximum status reads in flight against one RPC endpoint.
 */
export const TRANSACTION_STATUS_CONCURRENCY = 8;

const transactionStatusEntry = async (
  provider: RpcProvider,
  transactionHash: string,
): Promise<readonly [string, TransactionStatusReport]> => {
  try {
    return [
      transactionHash,
      classifyTransactionStatus(await provider.getTransactionStatus(transactionHash)),
    ];
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw error;
    }
    return [transactionHash, isTransactionNotFoundError(error) ? NOT_FOUND_REPORT : PENDING_REPORT];
  }
};

/**
 * Classifies one untrusted status response. Unknown finality stays pending and
 * unseen; only a recognised finality or a revert marks the hash as seen.
 */
export const classifyTransactionStatus = (receipt: {
  readonly execution_status?: unknown;
  readonly finality_status?: unknown;
}): TransactionStatusReport => {
  const finality = String(receipt.finality_status ?? "");
  // REVERTED wins over finality, including PRE_CONFIRMED.
  if (String(receipt.execution_status ?? "") === "REVERTED") {
    return {
      finalizedOnL1: finality === "ACCEPTED_ON_L1",
      found: true,
      seen: true,
      status: "reverted",
    };
  }
  const status = FINALITY_TO_STATUS[finality];
  if (status === undefined) {
    return SEEN_PENDING_FINALITIES.has(finality) ? SEEN_PENDING_REPORT : PENDING_REPORT;
  }
  return { finalizedOnL1: finality === "ACCEPTED_ON_L1", found: true, seen: true, status };
};

/**
 * Reads transaction status with bounded fanout and transport failover. Explicit
 * not-found answers remain distinct so callers can tally disappearances.
 */
export const getTransactionStatuses = async (
  { hashes, rpcUrls }: TransactionStatusInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<Readonly<Record<string, TransactionStatusReport>>> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      const uniqueHashes = [...new Set(hashes)];
      const entries: (readonly [string, TransactionStatusReport])[] = [];
      for (let offset = 0; offset < uniqueHashes.length; offset += TRANSACTION_STATUS_CONCURRENCY) {
        const batch = uniqueHashes.slice(offset, offset + TRANSACTION_STATUS_CONCURRENCY);
        entries.push(
          ...(await Promise.all(
            batch.map((transactionHash) => transactionStatusEntry(provider, transactionHash)),
          )),
        );
      }
      return Object.fromEntries(entries);
    },
    makeProvider,
  );
