/**
 * STRK20 response envelopes returned by privileged background handlers.
 */

import type { Strk20Phase } from "@bramble/privacy/phases";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { Strk20BalanceEntry, Strk20CallAndProof } from "@bramble/wallet-protocol/strk20";
import type { Strk20WalletPreparationReview } from "./strk20-wallet-preparations";

/**
 * STRK20 private balances returned through the dapp provider bridge.
 */
export type Strk20BalancesResponse = {
  readonly balances: readonly Strk20BalanceEntry[];
  readonly ok: true;
};

/**
 * STRK20 prepared call-and-proof returned through the dapp provider bridge.
 */
export type Strk20PrepareResponse = {
  readonly callAndProof: Strk20CallAndProof;
  readonly ok: true;
};

/**
 * Locally derived dapp-scoped STRK20 shadow-account commitment.
 */
export type Strk20ShadowAccountCommitmentResponse = {
  readonly commitment: string;
  readonly ok: true;
};

/**
 * Private-balance state returned only to an extension-controlled page after the
 * user explicitly enables disclosure.
 */
export type Strk20WalletStateResponse = {
  readonly ok: true;
  readonly strk20State: {
    readonly accountId: string;
    readonly balances: readonly {
      readonly balance: string;
      /**
       * The bounded converted pool fee in this token's base units, when an
       * independent reference priced the pool's STRK charge in it. Absent when
       * no bound exists, in which case a private batch falls back to the
       * configured fee token.
       */
      readonly feeCeiling?: string;
      readonly formatted: string;
      readonly symbol: string;
      readonly token: string;
      readonly tokenId: string;
    }[];
    /**
     * The configured fee token a private relayed batch falls back to when the
     * relay cannot quote its fee in the token being sent. Absent means STRK.
     */
    readonly feeToken?: string;
    readonly networkId: StarknetNetworkId;
    /** Pool action fee in FRI. A failed read rejects the state request. */
    readonly poolFeeFri: string;
    /** Whether this network has the unlinkable paymaster route private spends require. */
    readonly relayConfigured: boolean;
    /**
     * `pending` is derived locally, not read from the privacy service: a
     * registration this wallet broadcast that the indexer has not reflected yet.
     * Callers must treat it as "not shieldable, do not register again".
     */
    readonly registration: "pending" | "registered" | "unregistered";
  };
};

/**
 * A tracked background job the side panel polls for, returned by the request
 * that started it and by every poll while it still runs. A settled job answers
 * its poll with the response the work itself produced instead.
 *
 * `phase` is the fixed label the job last reported (absent until it reports
 * one); `attempt`/`attempts` name a bounded retry round; `elapsedMs` is how
 * long the job has run. None of it derives from the account or its notes.
 */
export type Strk20JobResponse = {
  readonly ok: true;
  readonly strk20Job: {
    readonly attempt?: number;
    readonly attempts?: number;
    readonly elapsedMs: number;
    readonly id: string;
    readonly phase?: Strk20Phase;
    readonly state: "running";
  };
};

/**
 * Frozen registration, deposit, or private-send review returned to the
 * extension side panel — or, for a route whose review is built by a tracked
 * job (a shield or an activation), the running job the panel polls for it.
 */
export type Strk20WalletPreparationResponse =
  | Strk20JobResponse
  | {
      readonly ok: true;
      readonly strk20Preparation: Strk20WalletPreparationReview;
    };

/**
 * Outcome of `wallet.strk20Execute`: the running job the panel polls, or —
 * once the poll settles — the broadcast hash. Idempotent on repeated polls:
 * the hash is the stored outcome of the one submission the claim allowed.
 */
export type Strk20WalletExecuteResponse =
  | Strk20JobResponse
  | { readonly ok: true; readonly transactionHash: string };

/**
 * Pool-registration status of a prospective private-send recipient, returned
 * only to an extension-controlled page.
 */
export type Strk20RecipientStatusResponse = {
  readonly ok: true;
  readonly strk20RecipientRegistration: "registered" | "unregistered";
};
