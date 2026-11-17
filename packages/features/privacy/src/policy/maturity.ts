/**
 * Accepted-transaction maturity contract shared by the privacy adapter and
 * its browser-session persistence boundary.
 */

import { type StarknetNetworkId, sameFelt } from "@bramble/wallet-model/networks";
import { STRK20_SERVICE_UNAVAILABLE } from "./fee-policy";

/**
 * Refusal of a privacy action because an EARLIER write on the same scope has
 * an outcome the wallet cannot prove yet: it may still land. It is raised only
 * while the proving block is chosen, before the refused action claims the
 * scope, so the refused action itself sent nothing; trying it again re-runs
 * the resolution. The panel shows reviewed copy for it
 * (`friendly-error-internal.ts`) and lists it as known not sent.
 */
export const STRK20_PRIOR_WRITE_UNRESOLVED = `${STRK20_SERVICE_UNAVAILABLE}: an earlier private transaction from this account may still be in progress`;

/**
 * The same refusal for an earlier write that no later check can resolve: its
 * marker is a relay claim that recorded no `WriteOnce` slots (written before
 * slots were recorded, or with no recorded route), so it names nothing the
 * chain can be asked about. Settings → Privacy offers to unlock the scope
 * anyway, stating that the earlier write could still land (mc-wallet #668).
 */
export const STRK20_PRIOR_WRITE_STRANDED = `${STRK20_SERVICE_UNAVAILABLE}: an earlier private transaction from this account may still be in progress, and no check can confirm it`;

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
 * How a privacy write leaves the wallet. `account` is signed by the account
 * itself, and its broadcast journals the signed identity before the signer
 * hands the signed transaction back, so an `account` claim with no identity provably sent nothing.
 * `relay` is built and sent by the private relay, which reports the hash only
 * in its answer: a `relay` claim with no hash may still have been sent.
 */
export type Strk20SubmissionRoute = "account" | "relay";

/**
 * Latest privacy write. `submitting` is persisted immediately before the
 * broadcast boundary so an indeterminate post-broadcast failure cannot be
 * mistaken for a clean scope. It carries the signed identity once the write is
 * signed, which lets a later action resolve the outcome on-chain instead of
 * waiting on an answer that was lost. Until then it carries the route the
 * write takes, and a `relay` claim also carries the `WriteOnce` slots its call
 * writes; a claim without a route (written before routes were recorded) is
 * treated like a `relay` claim and is never released as unsent.
 */
export type Strk20MaturityRecord =
  | ({
      readonly state: "submitting";
    } & (
      | (Strk20SignedSubmission & {
          readonly route?: never;
          readonly writeOnceSlots?: never;
        })
      | {
          readonly nonce?: never;
          readonly route?: Strk20SubmissionRoute;
          readonly senderAddress?: never;
          readonly transactionHash?: never;
          /**
           * A `relay` claim's `WriteOnce` slots (see `relay-claim-slots.ts`).
           * Once any reads non-zero, the relayed call can never apply.
           */
          readonly writeOnceSlots?: readonly string[];
        }
    ))
  | {
      readonly acceptedBlock?: number;
      readonly state: "submitted";
      readonly transactionHash: string;
      readonly writeOnceSlots?: never;
    }
  | {
      /**
       * A relay claim released because one of its `WriteOnce` slots was set in
       * this L1-finalized block: kept durably so every later proof, after any
       * failure, restart, or RPC change, targets a block past it (mc-wallet 668).
       */
      readonly acceptedBlock: number;
      readonly state: "released";
      readonly transactionHash?: never;
      readonly writeOnceSlots?: never;
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
  /**
   * Clears the scope only while its marker is an `account` claim that names no
   * signed write ({@link isUnsignedAccountClaim}), and returns whether it did.
   * Production runs the comparison and the clear as one serialized mutation,
   * so a marker a newer send journaled first is never cleared.
   */
  readonly releaseUnsigned: (scope: Strk20MaturityScope) => Promise<boolean>;
  /**
   * Replaces the scope's marker with a `released` record at `acceptedBlock`
   * only while it is the `relay` claim that recorded exactly `writeOnceSlots`,
   * and returns whether it did. Serialized like the other conditional updates,
   * so a newer send's marker is never replaced.
   */
  readonly releaseRelayClaim: (
    scope: Strk20MaturityScope,
    writeOnceSlots: readonly string[],
    acceptedBlock: number,
  ) => Promise<boolean>;
  /**
   * The user's "Unlock anyway": clears the scope only while its marker is
   * still the `submitting` record `expected` (the one the user acted on), and
   * returns whether it did. A marker a later send wrote is never cleared. The
   * earlier write may still land; only an explicit, informed user action
   * calls this.
   */
  readonly releaseSubmitting: (
    scope: Strk20MaturityScope,
    expected: Strk20MaturityRecord,
  ) => Promise<boolean>;
  readonly write: (
    scope: Strk20MaturityScope,
    record: Strk20MaturityRecord | null,
  ) => Promise<void>;
};

/**
 * True for a `submitting` claim on the `account` route that names no signed
 * write. The account route journals the signed identity before the signed
 * transaction leaves the signer, so such a claim proves no signed write left the signing path and was
 * therefore never sent. Whether a send is still running is the caller's
 * concern: a claim owned by a live send can still be signed.
 */
export const isUnsignedAccountClaim = (record: Strk20MaturityRecord | null): boolean =>
  record?.state === "submitting" &&
  record.transactionHash === undefined &&
  record.route === "account";

/**
 * True for a `submitting` relay claim that recorded exactly `writeOnceSlots`
 * (both sorted, canonical). A claim with other slots, or none, does not match.
 */
export const isRelayClaimWithSlots = (
  record: Strk20MaturityRecord | null,
  writeOnceSlots: readonly string[],
): boolean => {
  if (record?.state !== "submitting" || record.route !== "relay") return false;
  const recorded = record.writeOnceSlots;
  return (
    recorded !== undefined &&
    recorded.length === writeOnceSlots.length &&
    recorded.every((slot, index) => sameFelt(slot, writeOnceSlots[index] ?? ""))
  );
};

/**
 * True when `record` is still exactly `expected` and `expected` is a
 * `submitting` marker: the compare half of "Unlock anyway".
 */
export const isSameSubmitting = (
  record: Strk20MaturityRecord | null,
  expected: Strk20MaturityRecord,
): boolean =>
  expected.state === "submitting" &&
  record?.state === "submitting" &&
  JSON.stringify(canonicalRecord(record)) === JSON.stringify(canonicalRecord(expected));

// Key-sorted copy, so equal markers compare equal whatever their key order.
const canonicalRecord = (record: Strk20MaturityRecord): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));

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
      records.set(
        key,
        record.writeOnceSlots
          ? { ...record, writeOnceSlots: [...record.writeOnceSlots] }
          : { ...record },
      );
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
    async releaseUnsigned(scope) {
      if (!isUnsignedAccountClaim(records.get(scopeKey(scope)) ?? null)) {
        return false;
      }
      put(scope, null);
      return true;
    },
    async releaseRelayClaim(scope, writeOnceSlots, acceptedBlock) {
      if (!isRelayClaimWithSlots(records.get(scopeKey(scope)) ?? null, writeOnceSlots)) {
        return false;
      }
      put(scope, { acceptedBlock, state: "released" });
      return true;
    },
    async releaseSubmitting(scope, expected) {
      if (!isSameSubmitting(records.get(scopeKey(scope)) ?? null, expected)) {
        return false;
      }
      put(scope, null);
      return true;
    },
    async write(scope, record) {
      put(scope, record);
    },
  };
};
