/**
 * On-chain discovery of ERC20 allowances granted outside this wallet. For each
 * tracked token it pages the token's `Approval` events to find spenders the
 * active account has approved, then reads the current `allowance(owner,
 * spender)` so the amount reflects live chain state (an approval later changed
 * or revoked elsewhere is read at its true current value). The RPC node is the
 * discovery source; a dedicated indexer can replace {@link scanExternalAllowances}
 * without touching callers.
 */
import { type Call, CallData, type RpcProvider } from "starknet";
import {
  APPROVAL_EVENT_KEY,
  decodeApprovalEvent,
  type ExternalAllowance,
  parseAllowanceAmount,
} from "./allowance-discovery";
import { canonicalFelt, isNonZeroStarkFieldElement, sameFelt } from "./networks";
import { isTransportRpcError, withRpcFallback } from "./provider";

// Bounds so discovery stays cheap against a public RPC node: how many event
// pages to page through per token, and the ceiling on distinct spenders whose
// live allowance is read. A production indexer would lift these.
const MAX_EVENT_PAGES = 5;
const EVENT_CHUNK_SIZE = 100;
const MAX_SPENDERS_PER_TOKEN = 50;

/**
 * Minimal Starknet event filter this scan issues.
 */
export type AllowanceEventFilter = {
  readonly address: string;
  readonly chunk_size: number;
  readonly continuation_token?: string;
  readonly keys: readonly string[][];
};

/**
 * A single emitted event, narrowed to the fields discovery reads.
 */
export type AllowanceEvent = {
  readonly data: readonly string[];
  readonly keys: readonly string[];
};

/**
 * The RPC surface discovery needs: paged event reads and contract calls. Kept
 * narrow so it can be driven by a fake in tests and by an {@link RpcProvider}
 * in production.
 */
export type AllowanceRpc = {
  readonly callContract: (call: Call) => Promise<readonly string[]>;
  readonly getEvents: (filter: AllowanceEventFilter) => Promise<{
    readonly continuation_token?: string;
    readonly events?: readonly AllowanceEvent[];
  }>;
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

const discoverSpenders = async (
  rpc: AllowanceRpc,
  token: string,
  owner: string,
): Promise<readonly string[]> => {
  const spenders = new Set<string>();
  let continuationToken: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const chunk = await rpc.getEvents({
      address: token,
      chunk_size: EVENT_CHUNK_SIZE,
      keys: [[APPROVAL_EVENT_KEY]],
      ...(continuationToken === undefined ? {} : { continuation_token: continuationToken }),
    });
    for (const spender of spendersFromEvents(chunk.events ?? [], owner)) {
      spenders.add(spender);
      if (spenders.size >= MAX_SPENDERS_PER_TOKEN) {
        return [...spenders];
      }
    }
    if (chunk.continuation_token === undefined) {
      break;
    }
    continuationToken = chunk.continuation_token;
  }
  return [...spenders];
};

const readAllowance = async (
  rpc: AllowanceRpc,
  token: string,
  owner: string,
  spender: string,
): Promise<ExternalAllowance | null> => {
  const response = await rpc.callContract({
    calldata: CallData.compile([owner, spender]),
    contractAddress: token,
    entrypoint: "allowance",
  });
  const amount = parseAllowanceAmount(response);
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
): Promise<ExternalAllowance[]> => {
  const spenders = await discoverSpenders(rpc, token, owner);
  const allowances: ExternalAllowance[] = [];
  for (const spender of spenders) {
    const allowance = await readAllowance(rpc, token, owner, spender);
    if (allowance) {
      allowances.push(allowance);
    }
  }
  return allowances;
};

// Collects one token's allowances, isolating a per-token failure: a semantic
// (non-transport) fault means the contract has no usable Approval log and is
// swallowed as an empty result, while a transport fault propagates so the caller
// can fail over to another RPC endpoint rather than silently dropping a token.
const collectTokenAllowancesSafe = async (
  rpc: AllowanceRpc,
  token: string,
  owner: string,
): Promise<readonly ExternalAllowance[]> => {
  try {
    return await collectTokenAllowances(rpc, token, owner);
  } catch (error) {
    if (isTransportRpcError(error)) {
      throw error;
    }
    return [];
  }
};

/**
 * Collects the current external allowances for an owner across the given tokens
 * using an injected RPC surface. Separated from {@link scanExternalAllowances}
 * so the event-paging and allowance-read logic is testable without a network.
 * A per-token failure is skipped rather than aborting the whole scan.
 */
export const collectExternalAllowances = async (
  rpc: AllowanceRpc,
  { owner, tokens }: { readonly owner: string; readonly tokens: readonly string[] },
): Promise<readonly ExternalAllowance[]> => {
  const canonicalOwner = canonicalFelt(owner);
  if (!canonicalOwner || !isNonZeroStarkFieldElement(canonicalOwner)) {
    return [];
  }
  const discovered: ExternalAllowance[] = [];
  for (const token of canonicalTokens(tokens)) {
    discovered.push(...(await collectTokenAllowancesSafe(rpc, token, canonicalOwner)));
  }
  return discovered;
};

/**
 * Discovers external ERC20 allowances for an account across its tracked tokens,
 * failing over across the configured RPC endpoints. Returns an empty list when
 * no tokens are tracked; a caller treats a thrown transport error as
 * "discovery unavailable" and falls back to the locally tracked allowances.
 */
export const scanExternalAllowances = async (
  { owner, rpcUrls, tokens }: ExternalAllowanceScan,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<readonly ExternalAllowance[]> => {
  if (tokens.length === 0) {
    return [];
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
              ...(filter.continuation_token === undefined
                ? {}
                : { continuation_token: filter.continuation_token }),
            }),
        },
        { owner, tokens },
      ),
    makeProvider,
  );
};
