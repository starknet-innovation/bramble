/**
 * Reads, from chain, what became of OutsideExecution messages this wallet
 * signed for relay (issue 299). The account's SNIP-9 view
 * `is_valid_outside_execution_nonce(nonce)` answers false once an outside
 * execution with that nonce has run, so a used nonce is the proof a relayer
 * executed the message. An unused nonce at a block whose timestamp has passed
 * the message's deadline proves it can no longer run.
 *
 * Nothing else is inferred: a failed, unexpected or missing answer leaves the
 * record as it was, and absence of evidence is never read as an outcome. The
 * read is bounded per refresh and throttled per record, and runs only from an
 * Activity refresh.
 */
import { withRpcFallback } from "@bramble/starknet/provider";
import type { ActivityScope } from "@bramble/transactions/activity";
import type {
  RelaySignature,
  RelaySignatureLog,
  RelaySignatureStatus,
} from "@bramble/transactions/relay-signatures";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";

/** Most records read from chain in one Activity refresh. */
export const MAX_RELAY_READS_PER_REFRESH = 4;
/** A record is read again no sooner than this after its last attempt. */
export const RELAY_RECHECK_MS = 60_000;

const NONCE_VIEW = "is_valid_outside_execution_nonce";

const due = (entry: RelaySignature, now: number): boolean =>
  entry.status === "signed" &&
  entry.checkable &&
  (entry.checkedAt === undefined ||
    entry.checkedAt > now ||
    now - entry.checkedAt >= RELAY_RECHECK_MS);

// The view returns a Cairo bool: exactly one felt, 1 for unused and 0 for used.
const nonceUnused = (result: readonly string[]): boolean | null => {
  if (result.length !== 1) return null;
  const felt = canonicalFelt(result[0] ?? "");
  return felt === "0x1" ? true : felt === "0x0" ? false : null;
};

const readOne = async (
  provider: RpcProvider,
  address: string,
  entry: RelaySignature,
  nowSeconds: number,
): Promise<RelaySignatureStatus> => {
  const deadline = entry.executeBefore;
  // Only when the local clock says the deadline may have passed is a block
  // read: its own timestamp, not this device's clock, decides expiry, and the
  // nonce is read at that same block so the two answers agree.
  const block =
    deadline !== undefined && nowSeconds >= deadline
      ? await provider.getBlockWithTxHashes("latest")
      : null;
  const blockNumber =
    block && "block_number" in block && typeof block.block_number === "number"
      ? block.block_number
      : null;
  const unused = nonceUnused(
    await provider.callContract(
      { calldata: [entry.nonce], contractAddress: address, entrypoint: NONCE_VIEW },
      blockNumber ?? "latest",
    ),
  );
  if (unused === false) return "executed";
  if (
    unused === true &&
    deadline !== undefined &&
    blockNumber !== null &&
    typeof block?.timestamp === "number" &&
    block.timestamp >= deadline
  ) {
    return "expired";
  }
  return "signed";
};

/**
 * Reads up to {@link MAX_RELAY_READS_PER_REFRESH} due records for `scope` and
 * stores what the chain showed. Returns the scope's records, refreshed when any
 * read was attempted. Never throws: an unreadable log yields no rows, and a
 * failed read is stamped as attempted so it is not retried on every repaint.
 */
export const refreshRelaySignatures = async (
  deps: {
    readonly log: RelaySignatureLog;
    readonly rpcProviderFor?: (nodeUrl: string) => RpcProvider;
  },
  target: {
    readonly address: string;
    readonly rpcUrls: readonly string[];
    readonly scope: ActivityScope;
  },
  now: number,
): Promise<readonly RelaySignature[]> => {
  const stored = await deps.log.list(target.scope).catch(() => []);
  const batch = stored.filter((entry) => due(entry, now)).slice(0, MAX_RELAY_READS_PER_REFRESH);
  if (batch.length === 0) return stored;
  const reads = new Map<string, RelaySignatureStatus>();
  for (const entry of batch) {
    const status = await withRpcFallback(
      target.rpcUrls,
      (provider) => readOne(provider, target.address, entry, Math.floor(now / 1000)),
      deps.rpcProviderFor,
    ).catch((): RelaySignatureStatus => "signed");
    reads.set(entry.messageHash, status);
  }
  return deps.log.updateStatuses(target.scope, reads, now).catch(() => stored);
};
