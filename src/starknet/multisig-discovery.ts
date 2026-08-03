/**
 * Bounded on-chain discovery of MultisigComponent proposal identifiers.
 * Events are only a discovery hint: callers still read proposal state through
 * the contract views before offering any confirmation or execution action.
 */
import { hash, type RpcProvider } from "starknet";
import { WalletError } from "../shared/errors";
import { canonicalFelt, isNonZeroStarkFieldElement, sameFelt } from "./networks";
import { withRpcFallback } from "./provider";

const EVENT_CHUNK_SIZE = 100;
const MAX_EVENT_PAGES = 5;
const MAX_DISCOVERED_PROPOSALS = 100;
const DISCOVERY_BLOCK_WINDOW = 1_000_000;
const RECENT_BLOCK_STRIDE = 100_000;

/**
 * Selector emitted as the first key of the flattened OpenZeppelin event.
 */
export const MULTISIG_TRANSACTION_SUBMITTED_EVENT_KEY =
  hash.getSelectorFromName("TransactionSubmitted");

/**
 * Minimal event shape consumed from an untrusted Starknet RPC response.
 */
export type MultisigProposalEvent = {
  readonly keys: readonly string[];
};

/**
 * Exact bounded event filter used by proposal discovery.
 */
export type MultisigProposalEventFilter = {
  readonly address: string;
  readonly chunk_size: number;
  readonly continuation_token?: string;
  readonly from_block: number;
  readonly keys: readonly string[][];
  readonly to_block: number;
};

/**
 * Narrow RPC surface used by the testable proposal-event collector.
 */
export type MultisigProposalDiscoveryRpc = {
  readonly getEvents: (filter: MultisigProposalEventFilter) => Promise<{
    readonly continuation_token?: string;
    readonly events?: readonly MultisigProposalEvent[];
  }>;
  readonly getLatestBlockNumber: () => Promise<number>;
};

/**
 * Production proposal-discovery input.
 */
export type MultisigProposalDiscoveryInput = {
  readonly address: string;
  readonly rpcUrls: readonly string[];
};

/**
 * Bounded discovery result. `complete=false` means the page budget was
 * exhausted and the UI must not imply it found the full proposal history.
 */
export type MultisigProposalDiscovery = {
  readonly complete: boolean;
  readonly ids: readonly string[];
};

type PagedIds = MultisigProposalDiscovery;

const proposalIdFromEvent = (event: MultisigProposalEvent): string | null => {
  if (
    !Array.isArray(event.keys) ||
    event.keys.length !== 3 ||
    !sameFelt(event.keys[0], MULTISIG_TRANSACTION_SUBMITTED_EVENT_KEY) ||
    !isNonZeroStarkFieldElement(event.keys[2])
  ) {
    return null;
  }
  return canonicalFelt(event.keys[1]);
};

const pageProposalIds = async (
  rpc: MultisigProposalDiscoveryRpc,
  address: string,
  fromBlock: number,
  toBlock: number,
): Promise<PagedIds> => {
  const ids = new Set<string>();
  let continuationToken: string | undefined;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const chunk = await rpc.getEvents({
      address,
      chunk_size: EVENT_CHUNK_SIZE,
      from_block: fromBlock,
      keys: [[MULTISIG_TRANSACTION_SUBMITTED_EVENT_KEY]],
      to_block: toBlock,
      ...(continuationToken === undefined ? {} : { continuation_token: continuationToken }),
    });
    for (const event of chunk.events ?? []) {
      const id = proposalIdFromEvent(event);
      if (id) {
        ids.add(id);
      }
    }
    if (chunk.continuation_token === undefined) {
      return {
        complete: true,
        ids: [...ids].slice(-MAX_DISCOVERED_PROPOSALS).reverse(),
      };
    }
    continuationToken = chunk.continuation_token;
  }
  return {
    complete: false,
    ids: [...ids].slice(-MAX_DISCOVERED_PROPOSALS).reverse(),
  };
};

/**
 * Discovers recent submitted proposal IDs from a contract's events. A busy
 * range that exhausts the page budget is retried over the newest stride so the
 * bounded result remains recent; `complete` stays false to expose truncation.
 */
export const collectMultisigProposalIds = async (
  rpc: MultisigProposalDiscoveryRpc,
  address: string,
): Promise<MultisigProposalDiscovery> => {
  const canonicalAddress = canonicalFelt(address);
  if (!canonicalAddress || !isNonZeroStarkFieldElement(canonicalAddress)) {
    throw new WalletError("Invalid multisig address");
  }
  const latest = await rpc.getLatestBlockNumber();
  if (!Number.isSafeInteger(latest) || latest < 0) {
    throw new WalletError("Invalid multisig block response");
  }
  const fromBlock = Math.max(0, latest - DISCOVERY_BLOCK_WINDOW);
  const full = await pageProposalIds(rpc, canonicalAddress, fromBlock, latest);
  if (full.complete) {
    return full;
  }
  const recent = await pageProposalIds(
    rpc,
    canonicalAddress,
    Math.max(fromBlock, latest - RECENT_BLOCK_STRIDE),
    latest,
  );
  return { complete: false, ids: recent.ids };
};

/**
 * Discovers proposal IDs through the configured Starknet RPC fallback lane.
 */
export const discoverMultisigProposalIds = async (
  { address, rpcUrls }: MultisigProposalDiscoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<MultisigProposalDiscovery> =>
  withRpcFallback(
    rpcUrls,
    (provider) =>
      collectMultisigProposalIds(
        {
          getEvents: (filter) =>
            provider.getEvents({
              address: filter.address,
              chunk_size: filter.chunk_size,
              from_block: { block_number: filter.from_block },
              keys: filter.keys.map((group) => [...group]),
              to_block: { block_number: filter.to_block },
              ...(filter.continuation_token === undefined
                ? {}
                : { continuation_token: filter.continuation_token }),
            }),
          getLatestBlockNumber: () => provider.getBlockNumber(),
        },
        address,
      ),
    makeProvider,
  );
