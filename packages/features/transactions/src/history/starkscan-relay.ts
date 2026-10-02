/**
 * Discovers relayed SNIP-9 `OutsideExecution` transactions from the indexed
 * explorer. A relayed execution is submitted by a dapp, relayer or paymaster,
 * so the wallet never receives its transaction hash at signing time; the only
 * way to show the resulting on-chain event is to find it in chain history.
 *
 * Two indexed reads are combined: the account's transaction summaries (bounded
 * and cursor-paged), then the certified detail of the plausible candidates. A
 * transaction is retained as a relayed execution only when its decoded account
 * calls name this account with one of the two outside-execution selectors and
 * the call's calldata decodes to a complete SNIP-9 envelope: a wrong or
 * truncated shape is dropped, never guessed. Every field is re-checked by
 * {@link isActivityEntry} before it can reach storage.
 *
 * Trust boundary: the explorer is a third party that learns the address it is
 * asked about, so this runs only inside the permissioned explorer lane
 * (`./starkscan-wallet`), never as a keyless default. It never returns a
 * `messageHash`, so a discovered row cannot claim to be a message this wallet
 * signed; only a local `"relay-signed"` row carries one.
 *
 * Layout assumption: the transaction detail's `calldata` carries the account
 * calls' calldata concatenated in order, and `accountCalls` gives each call's
 * `to`, `selector` and declared `calldataLength`, so the exact calldata of the
 * matched call is the slice at the running offset. The reader fails closed if
 * the declared lengths do not fit the raw calldata, so a shape this build does
 * not understand yields no row rather than a misread one.
 */
import { type ActivityEntry, isActivityEntry } from "@bramble/transactions/activity";
import { isAccountIdForNetwork } from "@bramble/wallet-model/accounts";
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  sameFelt,
} from "@bramble/wallet-model/networks";
import { hash } from "starknet";
import { isSnip9RelayDetail, type Snip9RelayDetail } from "../activity/relay-detail";
import type { StarkscanClient } from "./starkscan";
import type {
  StarkscanAddressTransaction,
  StarkscanChainId,
  StarkscanTransactionDetail,
} from "./starkscan-types";
import { MAX_HISTORY_ENTRIES } from "./tx-history";
import type { TransactionHistoryScan } from "./tx-history-scan";

/** Selector of the SNIP-9 v1 `execute_from_outside` entry point. */
export const EXECUTE_FROM_OUTSIDE_SELECTOR = hash.getSelectorFromName("execute_from_outside");
/** Selector of the SNIP-9 v2 `execute_from_outside_v2` entry point. */
export const EXECUTE_FROM_OUTSIDE_V2_SELECTOR = hash.getSelectorFromName("execute_from_outside_v2");

// Bounds on a refresh so a beta, rate-limited source cannot fan out: how many
// summary pages to read, the page size, and how many certified details to fetch.
const MAX_DISCOVERY_PAGES = 2;
const DISCOVERY_PAGE_LIMIT = 50;
const MAX_DETAIL_FETCHES = 8;
const MAX_OUTSIDE_CALLS = 64;

type OutsideExecution = {
  readonly callCount: number;
  readonly caller: string;
  readonly nonce: string;
  readonly revision: "1" | "2";
};

const isInvokeSummary = (summary: StarkscanAddressTransaction): boolean =>
  summary.kinds.some((kind) => kind === "invoke") || summary.txType?.toLowerCase() === "invoke";

const revisionForSelector = (selector: string | null): "1" | "2" | null => {
  if (selector === null) {
    return null;
  }
  if (sameFelt(selector, EXECUTE_FROM_OUTSIDE_SELECTOR)) {
    return "1";
  }
  return sameFelt(selector, EXECUTE_FROM_OUTSIDE_V2_SELECTOR) ? "2" : null;
};

// Only an executed and accepted transaction is a relayed execution the user can
// see; a reverted or still-pending one is skipped rather than shown as a
// success. Unknown status spellings fail closed.
const isAcceptedExecution = (detail: StarkscanTransactionDetail): boolean =>
  detail.executionStatus === "SUCCEEDED" &&
  (detail.finalityStatus === "ACCEPTED_ON_L2" || detail.finalityStatus === "ACCEPTED_ON_L1");

// Slices the raw calldata of one account call by walking the declared call
// lengths: account calls name the calldata they consumed, so the matched call's
// felts are the slice at the running offset. Returns null on any overflow so a
// shape this build cannot trust yields no row.
const callCalldata = (
  detail: StarkscanTransactionDetail,
  callIndex: number,
): readonly string[] | null => {
  let offset = 0;
  for (let index = 0; index < detail.accountCalls.length; index += 1) {
    const call = detail.accountCalls[index];
    if (call === undefined || !Number.isSafeInteger(call.calldataLength)) {
      return null;
    }
    const end = offset + call.calldataLength;
    if (index === callIndex) {
      return call.calldataLength >= 0 && end <= detail.calldata.length
        ? detail.calldata.slice(offset, end)
        : null;
    }
    offset = end;
  }
  return null;
};

// The canonical felt of a word, or null when it is not a valid field element.
const feltAt = (words: readonly string[], index: number): string | null => {
  const word = words[index];
  return word === undefined ? null : canonicalFelt(word);
};

// A u64-style non-negative magnitude word, bounded so a hostile length cannot
// walk the reader off the end of the calldata.
const lengthAt = (words: readonly string[], index: number): number | null => {
  const word = feltAt(words, index);
  if (word === null) {
    return null;
  }
  const value = Number(BigInt(word));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

/**
 * Decodes a SNIP-9 `OutsideExecution` call's calldata enough to identify the
 * event: the revision (from the selector), the nonce and caller the envelope
 * commits to, and how many calls it carries. Returns null unless the whole
 * envelope - caller, nonce, timing, calls and the trailing signed response
 * felts - is present and well formed.
 */
export const decodeOutsideExecution = (
  calldata: readonly string[],
  revision: "1" | "2",
): OutsideExecution | null => {
  const caller = feltAt(calldata, 0);
  const nonce = feltAt(calldata, 1);
  const callCount = lengthAt(calldata, 4);
  if (caller === null || nonce === null || callCount === null || callCount > MAX_OUTSIDE_CALLS) {
    return null;
  }
  let index = 5;
  for (let call = 0; call < callCount; call += 1) {
    if (feltAt(calldata, index) === null || feltAt(calldata, index + 1) === null) {
      return null;
    }
    const dataLength = lengthAt(calldata, index + 2);
    if (dataLength === null) {
      return null;
    }
    index += 3 + dataLength;
    if (index > calldata.length) {
      return null;
    }
  }
  const signedLength = lengthAt(calldata, index);
  if (signedLength === null || signedLength < 1 || index + 1 + signedLength > calldata.length) {
    return null;
  }
  return { callCount, caller, nonce, revision };
};

const relayEntry = (
  detail: StarkscanTransactionDetail,
  execution: OutsideExecution,
  accountId: string,
  networkId: TransactionHistoryScan["networkId"],
): ActivityEntry | null => {
  if (!isAcceptedExecution(detail)) {
    return null;
  }
  const timestampMs = Date.parse(detail.timestampIso);
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
    return null;
  }
  const snip9: Snip9RelayDetail = {
    callCount: execution.callCount,
    caller: execution.caller,
    nonce: execution.nonce,
    revision: execution.revision,
  };
  if (!isSnip9RelayDetail(snip9)) {
    return null;
  }
  const relayer = detail.fromAddress === null ? null : canonicalFelt(detail.fromAddress);
  const entry: ActivityEntry = {
    accountId,
    ...(relayer === null ? {} : { counterparty: relayer }),
    hash: canonicalFelt(detail.txHash) ?? detail.txHash,
    kind: "invoke",
    networkId,
    origin: "relay",
    snip9,
    status: "accepted",
    submittedAt: timestampMs,
    summary: "Relayed execution",
  };
  return isActivityEntry(entry) ? entry : null;
};

const relayEntryFromDetail = (
  detail: StarkscanTransactionDetail,
  account: string,
  accountId: string,
  networkId: TransactionHistoryScan["networkId"],
): ActivityEntry | null => {
  const callIndex = detail.accountCalls.findIndex(
    (call) =>
      sameFelt(call.contractAddress, account) && revisionForSelector(call.selector) !== null,
  );
  if (callIndex < 0) {
    return null;
  }
  const revision = revisionForSelector(detail.accountCalls[callIndex]?.selector ?? null);
  if (revision === null) {
    return null;
  }
  const calldata = callCalldata(detail, callIndex);
  if (calldata === null) {
    return null;
  }
  const execution = decodeOutsideExecution(calldata, revision);
  return execution === null ? null : relayEntry(detail, execution, accountId, networkId);
};

/**
 * Finds the account's relayed SNIP-9 executions from the indexed explorer,
 * newest first and capped at {@link MAX_HISTORY_ENTRIES}. Devnet stays
 * RPC-only. A beta or rate-limited explorer makes this throw, which the caller
 * treats as a degraded source: it never hides local rows.
 */
export const discoverSnip9Executions = async (
  client: StarkscanClient,
  input: TransactionHistoryScan,
): Promise<readonly ActivityEntry[]> => {
  if (input.networkId === "SN_DEVNET") {
    throw new Error("Starkscan does not index devnet");
  }
  const account = canonicalFelt(input.account);
  if (
    account === null ||
    !isNonZeroStarkFieldElement(account) ||
    !isAccountIdForNetwork(input.accountId, input.networkId)
  ) {
    return [];
  }
  const chainId: StarkscanChainId = input.networkId;
  const candidates: StarkscanAddressTransaction[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
    const result = await client.getAddressTransactions(chainId, account, {
      limit: DISCOVERY_PAGE_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    candidates.push(...result.items.filter(isInvokeSummary));
    if (result.nextCursor === null) {
      break;
    }
    cursor = result.nextCursor;
  }
  candidates.sort(
    (left, right) => right.blockNumber - left.blockNumber || right.txIndex - left.txIndex,
  );
  const byHash = new Map<string, ActivityEntry>();
  for (const candidate of candidates.slice(0, MAX_DETAIL_FETCHES)) {
    const detail = await client.getTransactionDetail(chainId, candidate.txHash);
    const entry = relayEntryFromDetail(detail, account, input.accountId, input.networkId);
    if (entry !== null && !byHash.has(entry.hash)) {
      byHash.set(entry.hash, entry);
    }
  }
  return [...byHash.values()]
    .sort((left, right) => right.submittedAt - left.submittedAt)
    .slice(0, MAX_HISTORY_ENTRIES);
};
