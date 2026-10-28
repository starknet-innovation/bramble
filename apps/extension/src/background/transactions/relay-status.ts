/**
 * Reads, from chain, what became of OutsideExecution messages this wallet
 * signed for relay (issue 299). The account's SNIP-9 view
 * `is_valid_outside_execution_nonce(nonce)` answers false once an outside
 * execution with that nonce has run, so a used nonce proves the message can no
 * longer run. It does not prove this message was the one that ran: the dapp
 * chose the nonce. An unused nonce at a block whose timestamp has passed the
 * message's deadline proves it can no longer run either.
 *
 * Nothing else is inferred: a failed, unexpected or missing answer leaves the
 * record as it was, and absence of evidence is never read as an outcome. A
 * row whose nonce view is not verified is not asked that question. Once the
 * chain clock is past its Execute Before, that row is expired anyway. The
 * read is bounded per refresh and throttled per record, and runs only from an
 * Activity refresh. Rows never read go first, then the least recently read, so
 * no row is starved by newer ones. One refresh reads the latest block at most
 * once and the rows' nonces in parallel, so a slow node costs one round trip
 * rather than one per row.
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

type ProviderFor = (nodeUrl: string) => RpcProvider;

/** The latest block's number and timestamp: one clock for every row in a refresh. */
type ChainClock = { readonly blockNumber: number; readonly timestamp: number };

/** Most records read from chain in one Activity refresh. */
export const MAX_RELAY_READS_PER_REFRESH = 4;
/** A record is read again no sooner than this after its last attempt. */
export const RELAY_RECHECK_MS = 60_000;

const NONCE_VIEW = "is_valid_outside_execution_nonce";

const recheckReady = (entry: RelaySignature, now: number): boolean =>
  entry.checkedAt === undefined ||
  entry.checkedAt > now ||
  now - entry.checkedAt >= RELAY_RECHECK_MS;

const due = (entry: RelaySignature, now: number): boolean => {
  if (entry.status !== "signed" || !recheckReady(entry, now)) {
    return false;
  }
  if (entry.checkable) {
    return true;
  }
  return entry.executeBefore !== undefined && Math.floor(now / 1000) >= entry.executeBefore;
};

const expiredOnClock = (entry: RelaySignature, clock: ChainClock | null): boolean =>
  clock !== null && entry.executeBefore !== undefined && clock.timestamp >= entry.executeBefore;

// The view returns a Cairo bool: exactly one felt, 1 for unused and 0 for used.
const nonceUnused = (result: readonly string[]): boolean | null => {
  if (result.length !== 1) return null;
  const felt = canonicalFelt(result[0] ?? "");
  return felt === "0x1" ? true : felt === "0x0" ? false : null;
};

// The block's own timestamp, not this device's clock, decides expiry, so it is
// read only when some row's deadline may have passed by the local clock. A
// failed or malformed read leaves expiry undecided for this refresh.
const readChainClock = async (
  rpcUrls: readonly string[],
  rpcProviderFor: ProviderFor | undefined,
): Promise<ChainClock | null> => {
  const block = await withRpcFallback(
    rpcUrls,
    (provider) => provider.getBlockWithTxHashes("latest"),
    rpcProviderFor,
  ).catch(() => null);
  return block &&
    "block_number" in block &&
    typeof block.block_number === "number" &&
    typeof block.timestamp === "number"
    ? { blockNumber: block.block_number, timestamp: block.timestamp }
    : null;
};

const pastDeadline = (entry: RelaySignature, nowSeconds: number): boolean =>
  entry.executeBefore !== undefined && nowSeconds >= entry.executeBefore;

const readOne = async (
  provider: RpcProvider,
  address: string,
  entry: RelaySignature,
  clock: ChainClock | null,
): Promise<RelaySignatureStatus> => {
  const deadline = entry.executeBefore;
  // A row that can expire is read at the clock's block, so the nonce and the
  // timestamp describe the same chain state.
  const expiring = clock !== null && deadline !== undefined && clock.timestamp >= deadline;
  const unused = nonceUnused(
    await provider.callContract(
      { calldata: [entry.nonce], contractAddress: address, entrypoint: NONCE_VIEW },
      expiring ? clock.blockNumber : "latest",
    ),
  );
  if (unused === false) return "nonce-used";
  return unused === true && expiring ? "expired" : "signed";
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
    readonly rpcProviderFor?: ProviderFor;
  },
  target: {
    readonly address: string;
    readonly rpcUrls: readonly string[];
    readonly scope: ActivityScope;
  },
  now: number,
): Promise<readonly RelaySignature[]> => {
  const stored = await deps.log.list(target.scope).catch(() => []);
  const batch = stored
    .filter((entry) => due(entry, now))
    .sort((a, b) => (a.checkedAt ?? -1) - (b.checkedAt ?? -1))
    .slice(0, MAX_RELAY_READS_PER_REFRESH);
  if (batch.length === 0) return stored;
  const nowSeconds = Math.floor(now / 1000);
  const clock = batch.some((entry) => pastDeadline(entry, nowSeconds))
    ? await readChainClock(target.rpcUrls, deps.rpcProviderFor)
    : null;
  const statuses = await Promise.all(
    batch.map((entry) =>
      entry.checkable
        ? withRpcFallback(
            target.rpcUrls,
            (provider) => readOne(provider, target.address, entry, clock),
            deps.rpcProviderFor,
          ).catch((): RelaySignatureStatus => "signed")
        : Promise.resolve<RelaySignatureStatus>(
            expiredOnClock(entry, clock) ? "expired" : "signed",
          ),
    ),
  );
  const reads = new Map(
    batch.map((entry, index) => [entry.messageHash, statuses[index] ?? "signed"]),
  );
  return deps.log.updateStatuses(target.scope, reads, now).catch(() => stored);
};
