/**
 * Accepted-transaction maturity contract shared by the privacy adapter and
 * its browser-session persistence boundary.
 */

import { type StarknetNetworkId, sameFelt } from "@bramble/wallet-model/networks";

/**
 * Account/network/pool scope whose latest privacy write must mature before a
 * later proof can use historical state.
 */
export type Strk20MaturityScope = {
  readonly accountId: string;
  readonly networkId: StarknetNetworkId;
  readonly poolAddress: string;
};

/**
 * Public identity of a signed privacy write, journaled before it is sent: the
 * transaction hash to look it up by, and the sender and nonce that prove it can
 * no longer land once the sender's nonce has moved past it. Only account-mode
 * sends have one; the private relay builds its own transaction and reports the
 * hash only in its answer.
 */
export type Strk20SignedSubmission = {
  readonly nonce: string;
  readonly senderAddress: string;
  readonly transactionHash: string;
};

/**
 * Latest privacy write. `submitting` is persisted immediately before the
 * broadcast boundary so an indeterminate post-broadcast failure cannot be
 * mistaken for a clean scope. It carries the signed identity once the write is
 * signed, which lets a later action resolve the outcome on-chain instead of
 * waiting for the browser session to end.
 */
export type Strk20MaturityRecord =
  | ({
      readonly state: "submitting";
    } & (
      | Strk20SignedSubmission
      | { readonly nonce?: never; readonly senderAddress?: never; readonly transactionHash?: never }
    ))
  | {
      readonly acceptedBlock?: number;
      readonly state: "submitted";
      readonly transactionHash: string;
    };

/**
 * True when `record` still names `transactionHash`, whether the write is
 * `submitting` or already `submitted`. A missing hash does not match: a bare
 * submitting claim and an empty scope must not be replaced as if they were the
 * resolved write.
 */
export const maturityRecordNamesHash = (
  record: Strk20MaturityRecord | null,
  transactionHash: string,
): boolean => {
  if (!record || record.transactionHash === undefined) {
    return false;
  }
  return sameFelt(record.transactionHash, transactionHash);
};

/**
 * Minimal persistence boundary. Production uses trusted browser session
 * storage so a service-worker restart cannot forget a just-submitted write.
 * `replaceIfCurrentHash` is the conditional update: production runs the
 * comparison and the write as one serialized mutation, so a read that happened
 * earlier cannot overwrite a marker a newer send stored in between.
 */
export type Strk20MaturityStore = {
  readonly read: (scope: Strk20MaturityScope) => Promise<Strk20MaturityRecord | null>;
  /**
   * Writes `record` (or clears the scope, when `record` is null) only while the
   * stored marker still names `transactionHash`. Returns false and writes
   * nothing when it does not. Callers must leave the scope untouched on false.
   */
  readonly replaceIfCurrentHash: (
    scope: Strk20MaturityScope,
    transactionHash: string,
    record: Strk20MaturityRecord | null,
  ) => Promise<boolean>;
  readonly write: (
    scope: Strk20MaturityScope,
    record: Strk20MaturityRecord | null,
  ) => Promise<void>;
};

const scopeKey = (scope: Strk20MaturityScope): string =>
  `${scope.accountId}|${scope.networkId}|${scope.poolAddress}`;

/**
 * In-memory default for tests and environments without browser storage.
 */
export const memoryStrk20MaturityStore = (): Strk20MaturityStore => {
  const records = new Map<string, Strk20MaturityRecord>();
  const put = (scope: Strk20MaturityScope, record: Strk20MaturityRecord | null): void => {
    const key = scopeKey(scope);
    if (record) {
      records.set(key, { ...record });
    } else {
      records.delete(key);
    }
  };
  return {
    async read(scope) {
      return records.get(scopeKey(scope)) ?? null;
    },
    async replaceIfCurrentHash(scope, transactionHash, record) {
      if (!maturityRecordNamesHash(records.get(scopeKey(scope)) ?? null, transactionHash)) {
        return false;
      }
      put(scope, record);
      return true;
    },
    async write(scope, record) {
      put(scope, record);
    },
  };
};
