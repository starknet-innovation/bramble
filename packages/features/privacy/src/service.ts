/**
 * STRK20 privacy middleware contract. Protocol cryptography, discovery, and
 * proof generation are delegated to the pinned official privacy SDK; this
 * module enforces wallet-level balance/privacy policy and stable Wallet-API
 * errors around that dependency boundary.
 */

import { WalletError } from "@bramble/core/errors";
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import { REVIEWED_FEE_REQUIRED } from "@bramble/starknet/rpc-submit";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { StarkSignature } from "@bramble/wallet-model/signing";
import type {
  Strk20Action,
  Strk20BalanceEntry,
  Strk20CallAndProof,
  Strk20Proof,
} from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";
import type { Strk20NetworkConfig } from "./config";
import {
  assertFeeBalance,
  assertReviewedFeeCeiling,
  assertSufficientPrivateBalance,
  spentTokens,
} from "./policy/fee-guards";
import { canonicalStrk20PoolFee, STRK20_SERVICE_UNAVAILABLE } from "./policy/fee-policy";
import type { Strk20PhaseSink } from "./policy/phases";
import type { Strk20SubmissionPlan } from "./policy/submission-plan";

export { STRK20_INSUFFICIENT_BALANCE } from "./policy/fee-guards";
export {
  canonicalStrk20PoolFee,
  STRK20_FEE_ABOVE_CEILING,
  STRK20_FEE_CEILING_MULTIPLIER,
  STRK20_FEE_UNVERIFIABLE,
  STRK20_MAX_POOL_FEE,
  STRK20_SERVICE_UNAVAILABLE,
  type Strk20FeeReference,
} from "./policy/fee-policy";
/**
 * Frozen account and relay route types, defined beside privacy policy and
 * re-exported here as the stable service contract.
 */
export type {
  Strk20AccountPlan,
  Strk20PrivateRelayPlan,
  Strk20SubmissionPlan,
} from "./policy/submission-plan";
export {
  formatStrk20PoolFee,
  type Strk20AssetLookup,
  type Strk20FeeAsset,
  strk20CallToInvoke,
  summarizeStrk20Action,
  summarizeStrk20Plan,
} from "./policy/summaries";

/**
 * Wallet-API NOT_REGISTERED (118).
 */
export const STRK20_NOT_REGISTERED = "account not registered in strk20";
/**
 * Wallet-API INSUFFICIENT_PRIVATE_BALANCE (119).
 */
/**
 * Wallet-API PRIVACY_LEAK (120).
 */
export const STRK20_PRIVACY_LEAK = "strk20 privacy leak";
/**
 * No unlinkable broadcast service is configured.
 */
export const STRK20_SUBMISSION_UNAVAILABLE = "strk20 private submission unavailable";
/**
 * Privileged account context supplied only by the background worker. Viewing
 * keys and signatures are acquired lazily, never persisted, and never cross
 * the page/provider bridge.
 */
export type Strk20AccountContext = {
  readonly account: AccountRef;
  readonly config: Strk20NetworkConfig | null;
  /** Live unlock authorization checked at the final public-account write. */
  readonly isAuthorized: () => boolean;
  /**
   * Progress sink for the phases of a long operation (maturity, discovery,
   * proving, broadcast). Set only by a tracked background job; absent on every
   * request-path call, where reporting is a no-op. Receives fixed labels from
   * `./policy/phases` and nothing derived from the account or its notes.
   */
  readonly onPhase?: Strk20PhaseSink;
  readonly rpcUrls: readonly string[];
  readonly signHash: (messageHash: string) => Promise<StarkSignature>;
  readonly viewingKey: () => Promise<string>;
};

/**
 * A private-balance query. Empty `tokens` means every shielded token.
 */
export type Strk20BalancesInput = Strk20AccountContext & {
  readonly tokens: readonly string[];
};

/**
 * SDK preparation input.
 */
export type Strk20PrepareInput = Strk20AccountContext & {
  readonly actions: readonly Strk20Action[];
  readonly simulate: boolean;
};

/**
 * Prepared-proof submission input used by wallet_addInvokeTransaction.
 */
export type Strk20PreparedSubmissionInput = Strk20AccountContext & {
  /** Exact batch for a wallet-prepared public transaction. */
  readonly calls?: readonly Call[];
  /** Backward-compatible single pool call from wallet_strk20PrepareInvoke. */
  readonly call?: Call;
  readonly proof: Strk20Proof;
  /**
   * The network fee the approval card displayed for this prepared call. Carried
   * through to the invoke boundary as a signing ceiling (MCW-V09-119), so the
   * privacy send is held to the figure the user reviewed exactly like every
   * other approved invoke. Absent when no estimate was shown.
   */
  readonly reviewedFee?: FeeEstimate;
};

/**
 * Exact public-account calls and proof frozen before network-fee review. The
 * submitter must preserve the batch byte-for-byte and apply a reviewed ceiling.
 */
export type PreparedStrk20AccountSubmission = {
  readonly allowanceGrants: readonly Call[];
  readonly calls: readonly Call[];
  readonly proof: Strk20Proof;
};

/**
 * Outcome of a pool submission: the broadcast transaction, plus the ERC20
 * approvals that submission granted so the caller can track them.
 *
 * A deposit (and the pool fee) is pulled by the pool, so entering the pool
 * necessarily approves it to spend the account's PUBLIC balance. Those grants
 * are ordinary standing allowances owned by the submitting account, and the
 * allowance manager can only show or revoke a residual one if the submitter
 * reports it — reconstructing it from the actions at the call site would be a
 * second definition of the pool's own approval rule. `allowanceGrants` is
 * absent (never a lie) for a submission that approves nothing.
 */
export type Strk20SubmissionResult = {
  readonly allowanceGrants?: readonly Call[];
  readonly transactionHash: string;
};

/**
 * Injectable official-SDK adapter. Implementations must validate every SDK and
 * service response, target the configured pool, and fail closed.
 */
export type Strk20Service = {
  readonly privateBalances: (input: Strk20BalancesInput) => Promise<readonly Strk20BalanceEntry[]>;
  readonly prepare: (input: Strk20PrepareInput) => Promise<Strk20CallAndProof>;
  readonly registrationStatus?: (
    input: Strk20AccountContext & { readonly subject?: string; readonly token: string },
  ) => Promise<"registered" | "unregistered">;
  readonly register?: (
    input: Strk20AccountContext & { readonly poolFeeFri: string },
  ) => Promise<Strk20SubmissionResult>;
  /** Builds registration proof and calls without signing or broadcasting. */
  readonly prepareRegistration?: (
    input: Strk20AccountContext & { readonly poolFeeFri: string },
  ) => Promise<PreparedStrk20AccountSubmission>;
  /** Builds a deposit-only public-account proof and calls without broadcasting. */
  readonly prepareAccountActions?: (
    input: Strk20AccountContext & {
      readonly actions: readonly Strk20Action[];
      readonly beforeProof?: () => Promise<void>;
      readonly poolFeeFri: string;
    },
  ) => Promise<PreparedStrk20AccountSubmission>;
  /**
   * Reads the pool's per-`apply_actions` STRK fee so the UI can show it before
   * any quote exists. Absent implementations leave the fee unknown.
   */
  readonly poolFee?: (input: Strk20AccountContext) => Promise<string>;
  readonly quoteActions: (
    input: Strk20AccountContext & { readonly actions: readonly Strk20Action[] },
  ) => Promise<Strk20SubmissionPlan>;
  readonly subaccountCommitment: (
    input: Strk20AccountContext & { readonly dappName: string; readonly nonce?: string },
  ) => Promise<string>;
  readonly submitActions: (
    input: Strk20AccountContext & {
      readonly actions: readonly Strk20Action[];
      /** Final wallet policy gate invoked immediately before proof creation. */
      readonly beforeProof?: () => Promise<void>;
      readonly plan: Strk20SubmissionPlan;
    },
  ) => Promise<Strk20SubmissionResult>;
  readonly submitPrepared: (
    input: Strk20PreparedSubmissionInput,
  ) => Promise<{ readonly transactionHash: string }>;
};

// Names the stub explicitly. A build with no privacy runtime wired otherwise
// reports the same line as a live service that failed, which sends the reader
// looking at the backend for a wiring problem.
const unavailable = (): never => {
  throw new WalletError(`${STRK20_SERVICE_UNAVAILABLE}: no privacy runtime is wired in this build`);
};

/**
 * Fail-closed service used before the official SDK/runtime is wired.
 */
export const unavailableStrk20Service: Strk20Service = {
  async prepare() {
    return unavailable();
  },
  async prepareAccountActions() {
    return unavailable();
  },
  async prepareRegistration() {
    return unavailable();
  },
  async privateBalances() {
    return unavailable();
  },
  async poolFee() {
    return unavailable();
  },
  async quoteActions() {
    return unavailable();
  },
  async register() {
    return unavailable();
  },
  async registrationStatus() {
    return unavailable();
  },
  async subaccountCommitment() {
    return unavailable();
  },
  async submitActions() {
    return unavailable();
  },
  async submitPrepared() {
    return unavailable();
  },
};

const assertReviewedPoolFee = async (
  service: Strk20Service,
  input: Strk20AccountContext,
  expectedPoolFeeFri: string,
): Promise<void> => {
  if (!service.poolFee) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  const current = canonicalStrk20PoolFee(await service.poolFee(input));
  if (current !== canonicalStrk20PoolFee(expectedPoolFeeFri)) {
    throw new WalletError("Private pool fee changed. Review the transaction again.");
  }
};

const isDepositOnly = (actions: readonly Strk20Action[]): boolean =>
  actions.length > 0 && actions.every((action) => action.type === "deposit");

const assertNoPrivacyLeak = (actions: readonly Strk20Action[]): void => {
  const deposits = new Set<bigint>();
  const withdrawals = new Set<bigint>();
  for (const action of actions) {
    if (action.type === "deposit") {
      deposits.add(BigInt(action.token));
    } else if (action.type === "withdraw") {
      withdrawals.add(BigInt(action.token));
    }
  }
  for (const token of deposits) {
    if (withdrawals.has(token)) {
      throw new WalletError(STRK20_PRIVACY_LEAK);
    }
  }
};

// The relay's fee is a public withdrawal spliced into the batch after the
// caller's actions are checked, so the same deposit/withdrawal pairing must be
// refused on the combined set: a fee in a token the batch also deposits links
// the deposit to the private spend on chain (Sherlock 189).
const assertRelayFeeUnlinked = (
  actions: readonly Strk20Action[],
  plan: Strk20SubmissionPlan,
): void => {
  if (plan.mode !== "account") {
    assertNoPrivacyLeak([...actions, plan.feeAction]);
  }
};

const assertActionBatch = async (
  service: Strk20Service,
  input: Strk20AccountContext & { readonly actions: readonly Strk20Action[] },
): Promise<void> => {
  assertNoPrivacyLeak(input.actions);
  const tokens = spentTokens(input.actions);
  if (tokens.length > 0) {
    assertSufficientPrivateBalance(
      input.actions,
      await service.privateBalances({ ...input, tokens }),
    );
  }
};

/**
 * Reads private balances through the configured official SDK.
 */
export const readStrk20Balances = (
  service: Strk20Service,
  input: Strk20BalancesInput,
): Promise<readonly Strk20BalanceEntry[]> => service.privateBalances(input);

/**
 * Builds, but does not submit, a validated private call and proof. Simulation
 * returns the canonical empty proof envelope.
 */
export const prepareStrk20CallAndProof = async (
  service: Strk20Service,
  input: Strk20PrepareInput,
): Promise<Strk20CallAndProof> => {
  await assertActionBatch(service, input);
  return service.prepare(input);
};

/**
 * Performs only public/pure pre-approval validation and obtains the frozen
 * relay plan. It deliberately does not discover private balances; callers must
 * run the complete checks only after explicit user approval.
 */
export const quoteStrk20Plan = async (
  service: Strk20Service,
  input: Strk20AccountContext & { readonly actions: readonly Strk20Action[] },
): Promise<Strk20SubmissionPlan> => {
  assertNoPrivacyLeak(input.actions);
  // Deposits are public by definition and may be the account's first private
  // note. Routing them through the private relay would require a private fee
  // balance that cannot exist yet, and checking for one here would disclose
  // private state before the dapp request is approved. Keep the entry route
  // deterministic and pay its fee from the public account instead.
  if (isDepositOnly(input.actions)) {
    if (!service.poolFee) {
      throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
    }
    return { mode: "account", poolFeeFri: canonicalStrk20PoolFee(await service.poolFee(input)) };
  }
  const plan = await service.quoteActions(input);
  assertRelayFeeUnlinked(input.actions, plan);
  return plan;
};

/**
 * Obtains a frozen plan for an explicit wallet-owned journey and confirms its
 * private spend and fee remain affordable.
 */
export const quoteStrk20Actions = async (
  service: Strk20Service,
  input: Strk20AccountContext & { readonly actions: readonly Strk20Action[] },
): Promise<Strk20SubmissionPlan> => {
  await assertActionBatch(service, input);
  const plan = await quoteStrk20Plan(service, input);
  await assertFeeBalance(service, { ...input, plan });
  return plan;
};

/**
 * Proves and submits an approved action batch through the configured relayer.
 */
export const submitStrk20Actions = async (
  service: Strk20Service,
  input: Strk20AccountContext & {
    readonly actions: readonly Strk20Action[];
    readonly beforeProof?: () => Promise<void>;
    readonly plan: Strk20SubmissionPlan;
  },
): Promise<Strk20SubmissionResult> => {
  await assertActionBatch(service, input);
  assertRelayFeeUnlinked(input.actions, input.plan);
  if (input.plan.mode === "account" && !isDepositOnly(input.actions)) {
    throw new WalletError(STRK20_PRIVACY_LEAK);
  }
  if (input.plan.mode === "account") {
    if (!input.plan.reviewedFee) {
      throw new WalletError(REVIEWED_FEE_REQUIRED);
    }
    await assertReviewedPoolFee(service, input, input.plan.poolFeeFri);
  }
  assertReviewedFeeCeiling(input.plan);
  await assertFeeBalance(service, input);
  return service.submitActions(input);
};

/**
 * Builds the exact public deposit batch whose network fee must be reviewed.
 * The returned proof and calls are immutable approval input; no signing or
 * broadcast occurs at this boundary.
 */
export const prepareStrk20AccountActions = async (
  service: Strk20Service,
  input: Strk20AccountContext & {
    readonly actions: readonly Strk20Action[];
    readonly beforeProof?: () => Promise<void>;
    readonly poolFeeFri: string;
  },
): Promise<PreparedStrk20AccountSubmission> => {
  if (!service.prepareAccountActions || !isDepositOnly(input.actions)) {
    throw new WalletError(STRK20_PRIVACY_LEAK);
  }
  await assertActionBatch(service, input);
  await assertReviewedPoolFee(service, input, input.poolFeeFri);
  return service.prepareAccountActions(input);
};

/**
 * Discovers whether an address has registered its viewing key with the
 * configured pool — the active account by default, or `subject` (e.g. a send
 * recipient) when provided. The token scopes the SDK preflight request for the
 * account's own status only; setup of a channel or token channel is never
 * treated as registration, because the transfer builder opens those itself.
 */
export const readStrk20RegistrationStatus = (
  service: Strk20Service,
  input: Strk20AccountContext & { readonly subject?: string; readonly token: string },
): Promise<"registered" | "unregistered"> => {
  if (!service.registrationStatus) {
    return Promise.reject(new WalletError(STRK20_SERVICE_UNAVAILABLE));
  }
  return service.registrationStatus(input);
};

/**
 * Generates and submits the one-time pool registration using the account's
 * public Starknet transaction path. Callers must present and approve this
 * operation before invoking this boundary.
 */
export const registerStrk20Account = async (
  service: Strk20Service,
  input: Strk20AccountContext & { readonly poolFeeFri: string },
): Promise<Strk20SubmissionResult> => {
  if (!service.register) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  await assertReviewedPoolFee(service, input, input.poolFeeFri);
  return service.register(input);
};

/**
 * Builds the exact public registration batch before network-fee review. Throws
 * on unavailable preparation or a changed pool fee without broadcasting.
 */
export const prepareStrk20Registration = async (
  service: Strk20Service,
  input: Strk20AccountContext & { readonly poolFeeFri: string },
): Promise<PreparedStrk20AccountSubmission> => {
  if (!service.prepareRegistration) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  await assertReviewedPoolFee(service, input, input.poolFeeFri);
  return service.prepareRegistration(input);
};
