/**
 * STRK20 privacy middleware contract. Protocol cryptography, discovery, and
 * proof generation are delegated to the pinned official privacy SDK; this
 * module enforces wallet-level balance/privacy policy and stable Wallet-API
 * errors around that dependency boundary.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { StarkSignature } from "@mc-wallet/wallet-model/signing";
import type {
  Strk20Action,
  Strk20BalanceEntry,
  Strk20CallAndProof,
  Strk20InvokeCall,
  Strk20Proof,
} from "@mc-wallet/wallet-protocol/strk20";
import type { Call } from "starknet";
import type { Strk20NetworkConfig } from "./config";
import type { PaymasterAuthorizationReview } from "./paymaster/paymaster-typed-data";

/**
 * Wallet-API NOT_REGISTERED (118).
 */
export const STRK20_NOT_REGISTERED = "account not registered in strk20";
/**
 * Wallet-API INSUFFICIENT_PRIVATE_BALANCE (119).
 */
export const STRK20_INSUFFICIENT_BALANCE = "insufficient private balance";
/**
 * Wallet-API PRIVACY_LEAK (120).
 */
export const STRK20_PRIVACY_LEAK = "strk20 privacy leak";
/**
 * Live SDK services or contract routing are incomplete.
 */
export const STRK20_SERVICE_UNAVAILABLE = "strk20 services unavailable";
/**
 * No unlinkable broadcast service is configured.
 */
export const STRK20_SUBMISSION_UNAVAILABLE = "strk20 private submission unavailable";
/**
 * Maximum pool fee accepted by the wallet and the pool's u128 fee field.
 */
export const STRK20_MAX_POOL_FEE = (1n << 128n) - 1n;

/**
 * Parses a reviewed pool fee into its canonical felt representation. Values
 * outside the pool's u128 fee field fail closed before they can enter a digest.
 */
export const canonicalStrk20PoolFee = (value: string): string => {
  let fee: bigint;
  try {
    fee = BigInt(value);
  } catch {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  if (fee < 0n || fee > STRK20_MAX_POOL_FEE) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  return `0x${fee.toString(16)}`;
};

/**
 * Privileged account context supplied only by the background worker. Viewing
 * keys and signatures are acquired lazily, never persisted, and never cross
 * the page/provider bridge.
 */
export type Strk20AccountContext = {
  readonly account: AccountRef;
  readonly config: Strk20NetworkConfig | null;
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
  readonly call: Call;
  readonly proof: Strk20Proof;
};

/**
 * Paymaster fee and optional outside-execution typed data frozen before the
 * approval UI. The user authorizes these exact values before any signature or
 * proof is produced.
 */
export type Strk20PrivateRelayPlan = {
  readonly authorization?: PaymasterAuthorizationReview;
  readonly feeAction: {
    readonly amount: string;
    readonly recipient: string;
    readonly token: string;
    readonly type: "withdraw";
  };
  readonly mode?: "private-relay";
  readonly typedData?: unknown;
};

/**
 * Public account submission is permitted only for registration and
 * deposit-only batches. It exists so a fresh account can enter the pool before
 * it owns a private note with which to pay a relay fee.
 */
export type Strk20AccountPlan = {
  readonly mode: "account";
  /** Exact STRK pool fee committed by the review digest. */
  readonly poolFeeFri: string;
};

/**
 * Frozen submission route shown before protected proving or authorization.
 */
export type Strk20SubmissionPlan = Strk20PrivateRelayPlan | Strk20AccountPlan;

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
  ) => Promise<{ readonly transactionHash: string }>;
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
  ) => Promise<{ readonly transactionHash: string }>;
  readonly submitPrepared: (
    input: Strk20PreparedSubmissionInput,
  ) => Promise<{ readonly transactionHash: string }>;
};

const unavailable = (): never => {
  throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
};

/**
 * Fail-closed service used before the official SDK/runtime is wired.
 */
export const unavailableStrk20Service: Strk20Service = {
  async prepare() {
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

const spentTokens = (actions: readonly Strk20Action[]): readonly string[] => {
  const seen = new Map<bigint, string>();
  for (const action of actions) {
    if (action.type === "withdraw" || action.type === "transfer") {
      seen.set(BigInt(action.token), action.token);
    }
  }
  return [...seen.values()];
};

const assertSufficientPrivateBalance = (
  actions: readonly Strk20Action[],
  balances: readonly Strk20BalanceEntry[],
): void => {
  const required = new Map<bigint, bigint>();
  for (const action of actions) {
    if ((action.type === "withdraw" || action.type === "transfer") && action.amount !== "OPEN") {
      const token = BigInt(action.token);
      required.set(token, (required.get(token) ?? 0n) + BigInt(action.amount));
    }
  }
  for (const [token, amount] of required) {
    const entry = balances.find((balance) => BigInt(balance.token) === token);
    if (amount > (entry ? BigInt(entry.balance) : 0n)) {
      throw new WalletError(STRK20_INSUFFICIENT_BALANCE);
    }
  }
};

const assertFeeBalance = async (
  service: Strk20Service,
  input: Strk20AccountContext & {
    readonly actions: readonly Strk20Action[];
    readonly plan: Strk20SubmissionPlan;
  },
): Promise<void> => {
  if (input.plan.mode === "account") {
    return;
  }
  const feeAction = input.plan.feeAction;
  const balances = await service.privateBalances({ ...input, tokens: [feeAction.token] });
  const sameTokenSpend = input.actions.filter(
    (action) =>
      (action.type === "withdraw" || action.type === "transfer") &&
      BigInt(action.token) === BigInt(feeAction.token),
  );
  assertSufficientPrivateBalance([...sameTokenSpend, feeAction], balances);
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
  return service.quoteActions(input);
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
): Promise<{ readonly transactionHash: string }> => {
  await assertActionBatch(service, input);
  if (input.plan.mode === "account" && !isDepositOnly(input.actions)) {
    throw new WalletError(STRK20_PRIVACY_LEAK);
  }
  if (input.plan.mode === "account") {
    await assertReviewedPoolFee(service, input, input.plan.poolFeeFri);
  }
  await assertFeeBalance(service, input);
  return service.submitActions(input);
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
): Promise<{ readonly transactionHash: string }> => {
  if (!service.register) {
    throw new WalletError(STRK20_SERVICE_UNAVAILABLE);
  }
  await assertReviewedPoolFee(service, input, input.poolFeeFri);
  return service.register(input);
};

const shortAddress = (value: string): string =>
  value.length <= 13 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;

/**
 * Builds a review-friendly summary from dapp-supplied public action fields.
 */
export const summarizeStrk20Action = (action: Strk20Action): string => {
  if (action.type === "deposit") {
    return `Deposit ${action.amount} to private balance (${shortAddress(action.token)})`;
  }
  if (action.type === "withdraw") {
    return `Withdraw ${action.amount} to ${shortAddress(action.recipient)} (${shortAddress(action.token)})`;
  }
  if (action.type === "transfer") {
    const amount = action.amount === "OPEN" ? "an open note" : action.amount;
    return `Transfer ${amount} privately to ${shortAddress(action.recipient)} (${shortAddress(action.token)})`;
  }
  if (action.type === "subaccount_invoke") {
    return `Private ${action.dapp_name} sub-account invoke (${action.calls.length} calls)`;
  }
  return `Private invoke on ${shortAddress(action.contract)}`;
};

/**
 * Describes the fee route without exposing a private relay plan's typed data.
 */
export const summarizeStrk20Plan = (plan: Strk20SubmissionPlan): string =>
  plan.mode === "account"
    ? `Public account pool fee ${plan.poolFeeFri} STRK fri — first deposits are linked to this wallet`
    : [
        `Private relay fee ${plan.feeAction.amount} (${plan.feeAction.token})`,
        ...(plan.authorization
          ? [
              `outside execution by ${shortAddress(plan.authorization.caller)} from ${plan.authorization.executeAfter} until ${plan.authorization.executeBefore} for ${plan.authorization.publicCallCount} public approval call${plan.authorization.publicCallCount === 1 ? "" : "s"}`,
            ]
          : []),
      ].join(" · ");

/**
 * Converts a wire INVOKE_CALL into the starknet.js call shape.
 */
export const strk20CallToInvoke = (call: Strk20InvokeCall): Call => ({
  calldata: [...call.calldata],
  contractAddress: call.contract_address,
  entrypoint: call.entry_point,
});
