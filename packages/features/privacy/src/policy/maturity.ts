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
 * marker is an unsigned relay claim (or one with no recorded route), so it
 * names nothing the chain can be asked about. Only ending the browser session
 * clears the session-held marker, so this sentence says so instead of
 * offering a check that cannot succeed.
 */
export const STRK20_PRIOR_WRITE_STRANDED = `${STRK20_SERVICE_UNAVAILABLE}: an earlier private transaction from this account may still be in progress; close every browser window and reopen the browser to recover`;

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
 * waiting for the browser session to end. Until then it carries the route the
 * write takes; a claim without a route (written before routes were recorded)
 * is treated like a `relay` claim and is never released as unsent.
 *
 * `proofBaseBlock` is the base block its proof names. The pool applies a proof
 * only in a block at most `get_proof_validity_blocks()` past that base, which
 * bounds where a signed write whose nonce is still unspent can land.
 */
export type Strk20MaturityRecord =
  | ({
      readonly proofBaseBlock?: number;
      readonly state: "submitting";
    } & (
      | (Strk20SignedSubmission & { readonly route?: never })
      | {
          readonly nonce?: never;
          readonly route?: Strk20SubmissionRoute;
          readonly senderAddress?: never;
          readonly transactionHash?: never;
        }
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
  /**
   * Clears the scope only while its marker is an `account` claim that names no
   * signed write ({@link isUnsignedAccountClaim}), and returns whether it did.
   * Production runs the comparison and the clear as one serialized mutation,
   * so a marker a newer send journaled first is never cleared.
   */
  readonly releaseUnsigned: (scope: Strk20MaturityScope) => Promise<boolean>;
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
    async releaseUnsigned(scope) {
      if (!isUnsignedAccountClaim(records.get(scopeKey(scope)) ?? null)) {
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
