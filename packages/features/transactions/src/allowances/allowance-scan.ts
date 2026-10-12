/**
 * On-chain reading of ERC20 allowances. Two entry points, both RPC-backed:
 * {@link readTrackedAllowances} reads the live amount of a pair the wallet
 * already has a local record for (no event scan, no token registry, any owner),
 * and {@link scanExternalAllowances} discovers pairs the wallet has never seen.
 *
 * Discovery of allowances granted outside this wallet works as follows. For each
 * tracked token it pages the token's `Approval` events to find spenders the
 * active account has approved, then reads the current `allowance(owner,
 * spender)` so the amount reflects live chain state (an approval later changed
 * or revoked elsewhere is read at its true current value). The RPC node is the
 * discovery source; a dedicated indexer can replace {@link scanExternalAllowances}
 * without touching callers.
 *
 * `getEvents` streams a token's log oldest-first, so an unfiltered read of a
 * busy token spends its page budget on the first approvals anyone ever made and
 * never reaches the account's own (Sherlock 181). Discovery therefore asks the
 * node for the account's approvals by key first, and says when it could not
 * read a log to the end, so the manager never reports "none found" for a scan
 * that stopped early. A legacy-layout approval names its owner only in the data
 * payload, which no key filter reaches, so those are read from the token's
 * recent blocks backwards, never from its first event.
 */

import { isTransportRpcError, withRpcFallback } from "@bramble/starknet/provider";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { type Call, CallData, type RpcProvider } from "starknet";
import {
  type AllowanceReading,
  APPROVAL_EVENT_KEY,
  decodeApprovalEvent,
  type ExternalAllowance,
  parseAllowanceAmount,
} from "./allowance-discovery";

// Bounds so discovery stays cheap against a public RPC node: how many event
// pages to page through per token for each of the two reads below, and the
// ceiling on distinct spenders whose live allowance is read. A production
// indexer would lift these.
const OWNER_EVENT_PAGES = 5;
const LOG_EVENT_PAGES = 3;
const EVENT_CHUNK_SIZE = 100;
const MAX_SPENDERS_PER_TOKEN = 50;
// The unfiltered read for legacy-layout approvals walks back from the head one
// block window at a time, at most this many windows. 200,000 blocks is about
// four days at mainnet's ~1.7 s blocks, the range the history scan found a
// public node answers inside its per-request deadline (see
// ../history/tx-history-scan.ts); three windows reach back about twelve days.
const LEGACY_BLOCK_WINDOW = 200_000;
const LEGACY_WINDOWS = 3;

/**
 * Minimal Starknet event filter this scan issues.
 */
export type AllowanceEventFilter = {
  readonly address: string;
  readonly chunk_size: number;
  readonly continuation_token?: string;
  // Bounds the legacy read to one block window; the owner read is unbounded.
  readonly from_block?: number;
  readonly keys: readonly string[][];
  readonly to_block?: number;
};

/**
 * A single emitted event, narrowed to the fields discovery reads.
 */
export type AllowanceEvent = {
  readonly data: readonly string[];
  readonly keys: readonly string[];
};

/**
 * The RPC surface a direct allowance read needs. Kept separate from
 * {@link AllowanceRpc} so reading an already-known pair does not have to be
 * handed an event reader it will never call.
 */
export type AllowanceCallRpc = {
  readonly callContract: (call: Call) => Promise<readonly string[]>;
};

/**
 * The RPC surface event-driven discovery needs: paged event reads plus contract
 * calls. Kept narrow so it can be driven by a fake in tests and by an
 * {@link RpcProvider} in production.
 */
export type AllowanceRpc = AllowanceCallRpc & {
  readonly getEvents: (filter: AllowanceEventFilter) => Promise<{
    readonly continuation_token?: string;
    readonly events?: readonly AllowanceEvent[];
  }>;
  readonly getLatestBlockNumber: () => Promise<number>;
};

/**
 * Inputs for discovering external allowances for one account on one network.
 */
export type ExternalAllowanceScan = {
  readonly owner: string;
  readonly rpcUrls: readonly string[];
  readonly tokens: readonly string[];
};

// Decodes each Approval event through the shared, tested decoder (one layout
// definition for both Cairo generations) and keeps the spenders the requested
// owner approved. Reusing decodeApprovalEvent avoids a second, drift-prone copy
// of the key/data layout detection.
const spendersFromEvents = (events: readonly AllowanceEvent[], owner: string): string[] => {
  const spenders: string[] = [];
  for (const event of events) {
    const decoded = decodeApprovalEvent(event);
    if (decoded && sameFelt(decoded.owner, owner)) {
      spenders.push(decoded.spender);
    }
  }
  return spenders;
};

type SpenderPage = {
  // True when an event in the Cairo 1 layout (owner and spender in the keys)
  // was read.
  readonly cairo1Layout: boolean;
  // True when an event in the legacy layout (owner and spender in the data
  // payload) was read, which a key filter on the owner can never match.
  readonly legacyLayout: boolean;
  readonly spenders: readonly string[];
  // True when the page budget ran out while the node still had events to return.
  readonly truncated: boolean;
};

type BlockRange = { readonly from_block: number; readonly to_block: number };

const pageSpenders = async (
  rpc: AllowanceRpc,
  token: string,
  owner: string,
  keys: readonly string[][],
  pages: number,
  range?: BlockRange,
): Promise<SpenderPage> => {
  const spenders: string[] = [];
  let cairo1Layout = false;
  let legacyLayout = false;
  let continuationToken: string | undefined;
  for (let page = 0; page < pages; page += 1) {
    const chunk = await rpc.getEvents({
      address: token,
      chunk_size: EVENT_CHUNK_SIZE,
      keys,
      ...range,
      ...(continuationToken === undefined ? {} : { continuation_token: continuationToken }),
    });
    const events = chunk.events ?? [];
    cairo1Layout ||= events.some((event) => event.keys.length >= 3);
    legacyLayout ||= events.some((event) => event.keys.length < 3);
    spenders.push(...spendersFromEvents(events, owner));
    if (chunk.continuation_token === undefined) {
      return { cairo1Layout, legacyLayout, spenders, truncated: false };
    }
    continuationToken = chunk.continuation_token;
  }
  return { cairo1Layout, legacyLayout, spenders, truncated: true };
};

type DiscoveredSpenders = {
  readonly complete: boolean;
  readonly spenders: readonly string[];
};

// The unfiltered read for legacy-layout approvals, newest window first.
// - A window holding Cairo 1 events and no legacy-layout one shows the token
//   now emits the Cairo 1 layout, which the owner read covers at any age, so
//   the walk ends there as covered. That is the mainnet ETH and STRK case,
//   whose logs start with Cairo 0 approvals from before their upgrade.
// - A window holding legacy events too many for the page budget leaves some
//   unread: incomplete.
// - An empty window, or one whose legacy events all fit, says nothing about
//   older blocks, so the walk goes on.
// Past the last window the rest of the log is read from its first block, as
// the whole read used to be: a quiet token finishes there, and a busy one is
// incomplete only if that read is cut short while showing legacy events.
// A legacy approval from before a token's Cairo 1 upgrade is not looked for:
// an RPC node cannot be asked for it by owner, and the pre-upgrade log of a
// busy token does not fit any page budget.
const legacySpenders = async (
  rpc: AllowanceRpc,
  token: string,
  owner: string,
): Promise<DiscoveredSpenders> => {
  const spenders: string[] = [];
  const keys = [[APPROVAL_EVENT_KEY]];
  let toBlock = await rpc.getLatestBlockNumber();
  for (let window = 0; window < LEGACY_WINDOWS; window += 1) {
    const fromBlock = Math.max(0, toBlock - LEGACY_BLOCK_WINDOW + 1);
    const read = await pageSpenders(rpc, token, owner, keys, LOG_EVENT_PAGES, {
      from_block: fromBlock,
      to_block: toBlock,
    });
    spenders.push(...read.spenders);
    if (read.cairo1Layout && !read.legacyLayout) {
      return { complete: true, spenders };
    }
    if (read.truncated) {
      return { complete: false, spenders };
    }
    if (fromBlock === 0) {
      return { complete: true, spenders };
    }
    toBlock = fromBlock - 1;
  }
  const rest = await pageSpenders(rpc, token, owner, keys, LOG_EVENT_PAGES, {
    from_block: 0,
    to_block: toBlock,
  });
  spenders.push(...rest.spenders);
  return { complete: !rest.truncated || !rest.legacyLayout, spenders };
};

// Two reads per token. A Cairo 1 token indexes the owner as key 1, so the first
// read asks the node for this owner's approvals only, and the page budget is
// spent on them rather than on every holder's. A legacy token keeps owner and
// spender in the data payload, which no key filter can match, so the second
// read walks the unfiltered log back from the head (see legacySpenders).
// Discovery is complete when the owner read reached its end and the legacy
// walk covered its range.
const discoverSpenders = async (
  rpc: AllowanceRpc,
  token: string,
  owner: string,
): Promise<DiscoveredSpenders> => {
  const owned = await pageSpenders(
    rpc,
    token,
    owner,
    [[APPROVAL_EVENT_KEY], [owner]],
    OWNER_EVENT_PAGES,
  );
  const log = await legacySpenders(rpc, token, owner);
  const spenders = [...new Set([...owned.spenders, ...log.spenders])];
  return {
    complete: !owned.truncated && log.complete && spenders.length <= MAX_SPENDERS_PER_TOKEN,
    spenders: spenders.slice(0, MAX_SPENDERS_PER_TOKEN),
  };
};

// The single `allowance(owner, spender)` read every discovery path shares, so
// event-driven discovery and the direct read of an already-tracked pair can
// never disagree about calldata or response parsing.
const readAllowanceAmount = async (
  rpc: AllowanceCallRpc,
  token: string,
  owner: string,
  spender: string,
): Promise<string | null> =>
  parseAllowanceAmount(
    await rpc.callContract({
      calldata: CallData.compile([owner, spender]),
      contractAddress: token,
      entrypoint: "allowance",
    }),
  );

const readAllowance = async (
  rpc: AllowanceRpc,
  token: string,
  owner: string,
  spender: string,
): Promise<ExternalAllowance | null> => {
  const amount = await readAllowanceAmount(rpc, token, owner, spender);
  return amount && amount !== "0" ? { amount, spender, token } : null;
};

// Canonicalizes and validates the tracked token list once, dropping any entry
// that is not a non-zero field element so the scan loop below stays a flat map
// over already-trustworthy tokens (parse, don't re-validate mid-loop).
const canonicalTokens = (tokens: readonly string[]): string[] => {
  const valid: string[] = [];
  for (const raw of tokens) {
    const token = canonicalFelt(raw);
    if (token && isNonZeroStarkFieldElement(token)) {
      valid.push(token);
    }
  }
  return valid;
};

// Collects every live, non-zero allowance the owner granted on a single token:
// discover the approved spenders from Approval events, then read each one's
// current on-chain allowance. Dropping the zero/absent reads here keeps
// collectExternalAllowances a flat fetch -> collect-per-token -> accumulate.
const collectTokenAllowances = async (
  rpc: AllowanceRpc,
  token: string,
  owner: string,
): Promise<ExternalAllowanceScanResult> => {
  const { complete, spenders } = await discoverSpenders(rpc, token, owner);
  const allowances: ExternalAllowance[] = [];
  for (const spender of spenders) {
    const allowance = await readAllowance(rpc, token, owner, spender);
    if (allowance) {
      allowances.push(allowance);
    }
  }
  return { allowances, complete };
};

// Collects one token's allowances, isolating a per-token failure: a semantic
// (non-transport) fault means the contract has no usable Approval log and is
// skipped as an incomplete result, while a transport fault propagates so the
// caller can fail over to another RPC endpoint rather than silently dropping a
// token.
const collectTokenAllowancesSafe = async (
  rpc: AllowanceRpc,
  token: string,
  owner: string,
): Promise<ExternalAllowanceScanResult> => {
  try {
    return await collectTokenAllowances(rpc, token, owner);
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw error;
    }
    return { allowances: [], complete: false };
  }
};

/**
 * The outcome of discovering one owner's external allowances. `complete` is
 * false when any token's `Approval` log could not be read to the end within the
 * page budget, held legacy-layout approvals in recent blocks beyond what was read,
 * named more spenders than are read, or could not be read at all: an empty
 * `allowances` list then means "none found in what was read", not "none".
 */
export type ExternalAllowanceScanResult = {
  readonly allowances: readonly ExternalAllowance[];
  readonly complete: boolean;
};

const EMPTY_SCAN: ExternalAllowanceScanResult = { allowances: [], complete: true };

/**
 * Collects the current external allowances for an owner across the given tokens
 * using an injected RPC surface. Separated from {@link scanExternalAllowances}
 * so the event-paging and allowance-read logic is testable without a network.
 * A per-token failure is skipped, and marks the result incomplete, rather than
 * aborting the whole scan.
 */
export const collectExternalAllowances = async (
  rpc: AllowanceRpc,
  { owner, tokens }: { readonly owner: string; readonly tokens: readonly string[] },
): Promise<ExternalAllowanceScanResult> => {
  const canonicalOwner = canonicalFelt(owner);
  if (!canonicalOwner || !isNonZeroStarkFieldElement(canonicalOwner)) {
    return EMPTY_SCAN;
  }
  const discovered: ExternalAllowance[] = [];
  let complete = true;
  for (const token of canonicalTokens(tokens)) {
    const result = await collectTokenAllowancesSafe(rpc, token, canonicalOwner);
    discovered.push(...result.allowances);
    complete &&= result.complete;
  }
  return { allowances: discovered, complete };
};

/**
 * One (owner, token, spender) triple the wallet already has a local record for,
 * carrying that record's id so a reading can be matched back to it without
 * re-deriving the id shape.
 */
export type TrackedAllowancePair = {
  readonly id: string;
  readonly owner: string;
  readonly spender: string;
  readonly token: string;
};

/**
 * Inputs for reading the live amount of allowances the wallet already tracks.
 */
export type TrackedAllowanceScan = {
  readonly pairs: readonly TrackedAllowancePair[];
  readonly rpcUrls: readonly string[];
};

// One contract call per pair, so the list is bounded. Callers order the pairs
// that most need a fresh reading first (see ../background/allowance-ops.ts):
// beyond this many, a record simply keeps its stored amount.
const MAX_TRACKED_PAIRS = 60;

/**
 * Reads the live `allowance(owner, spender)` for pairs the wallet already
 * tracks, using an injected RPC surface.
 *
 * Unlike {@link collectExternalAllowances} this needs no event scan and no
 * token registry: the pair comes from the local log, so it reaches a token the
 * user does not track and an owner that is not the active account (a multisig
 * the account signs for). A per-pair semantic failure is skipped — a contract
 * with no ERC20 `allowance` view simply yields no reading — while a transport
 * failure propagates so the caller can fail over to another endpoint.
 */
export const collectTrackedAllowances = async (
  rpc: AllowanceCallRpc,
  pairs: readonly TrackedAllowancePair[],
): Promise<readonly AllowanceReading[]> => {
  const readings: AllowanceReading[] = [];
  for (const pair of pairs.slice(0, MAX_TRACKED_PAIRS)) {
    const owner = canonicalFelt(pair.owner);
    const token = canonicalFelt(pair.token);
    const spender = canonicalFelt(pair.spender);
    if (!owner || !token || !spender || !isNonZeroStarkFieldElement(owner)) {
      continue;
    }
    try {
      const amount = await readAllowanceAmount(rpc, token, owner, spender);
      if (amount !== null) {
        readings.push({ amount, id: pair.id });
      }
    } catch (error) {
      if (isTransportRpcError(error)) {
        throw error;
      }
    }
  }
  return readings;
};

/**
 * Reads live amounts for already-tracked allowances, failing over across the
 * configured RPC endpoints. Returns an empty list when there is nothing to read;
 * a caller treats a thrown transport error as "reading unavailable" and keeps
 * the locally tracked amounts.
 */
export const readTrackedAllowances = async (
  { pairs, rpcUrls }: TrackedAllowanceScan,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<readonly AllowanceReading[]> => {
  if (pairs.length === 0) {
    return [];
  }
  return withRpcFallback(
    rpcUrls,
    (provider) =>
      collectTrackedAllowances(
        { callContract: (call) => provider.callContract(call, "latest") },
        pairs,
      ),
    makeProvider,
  );
};

/**
 * Discovers external ERC20 allowances for an account across its tracked tokens,
 * failing over across the configured RPC endpoints. Returns an empty, complete
 * result when no tokens are tracked; a caller treats a thrown transport error
 * as "discovery unavailable" and falls back to the locally tracked allowances.
 */
export const scanExternalAllowances = async (
  { owner, rpcUrls, tokens }: ExternalAllowanceScan,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<ExternalAllowanceScanResult> => {
  if (tokens.length === 0) {
    return EMPTY_SCAN;
  }
  return withRpcFallback(
    rpcUrls,
    (provider) =>
      collectExternalAllowances(
        {
          callContract: (call) => provider.callContract(call, "latest"),
          getEvents: (filter) =>
            provider.getEvents({
              address: filter.address,
              chunk_size: filter.chunk_size,
              keys: filter.keys.map((group) => [...group]),
              ...(filter.from_block === undefined
                ? {}
                : { from_block: { block_number: filter.from_block } }),
              ...(filter.to_block === undefined
                ? {}
                : { to_block: { block_number: filter.to_block } }),
              ...(filter.continuation_token === undefined
                ? {}
                : { continuation_token: filter.continuation_token }),
            }),
          getLatestBlockNumber: () => provider.getBlockNumber(),
        },
        { owner, tokens },
      ),
    makeProvider,
  );
};
