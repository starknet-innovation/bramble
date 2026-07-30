/**
 * STRK20 privacy middleware contract. Protocol cryptography, discovery, and
 * proof generation are delegated to the pinned official privacy SDK; this
 * module enforces wallet-level balance/privacy policy and stable Wallet-API
 * errors around that dependency boundary.
 */
import type { Call } from "starknet";
import type { StarkSignature } from "../../crypto/krusty";
import { WalletError } from "../../shared/errors";
import type { AccountRef } from "../../storage/vault-schema";
import type { Strk20NetworkConfig } from "./config";
import type {
  Strk20Action,
  Strk20BalanceEntry,
  Strk20CallAndProof,
  Strk20InvokeCall,
  Strk20Proof,
} from "./schemas";

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
export type Strk20SubmissionPlan = {
  readonly feeAction: {
    readonly amount: string;
    readonly recipient: string;
    readonly token: string;
    readonly type: "withdraw";
  };
  readonly typedData?: unknown;
};

/**
 * Injectable official-SDK adapter. Implementations must validate every SDK and
 * service response, target the configured pool, and fail closed.
 */
export type Strk20Service = {
  readonly privateBalances: (input: Strk20BalancesInput) => Promise<readonly Strk20BalanceEntry[]>;
  readonly prepare: (input: Strk20PrepareInput) => Promise<Strk20CallAndProof>;
  readonly quoteActions: (
    input: Strk20AccountContext & { readonly actions: readonly Strk20Action[] },
  ) => Promise<Strk20SubmissionPlan>;
  readonly subaccountCommitment: (
    input: Strk20AccountContext & { readonly dappName: string; readonly nonce?: string },
  ) => Promise<string>;
  readonly submitActions: (
    input: Strk20AccountContext & {
      readonly actions: readonly Strk20Action[];
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
  async quoteActions() {
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
  const feeAction = input.plan.feeAction;
  const balances = await service.privateBalances({ ...input, tokens: [feeAction.token] });
  const sameTokenSpend = input.actions.filter(
    (action) =>
      (action.type === "withdraw" || action.type === "transfer") &&
      BigInt(action.token) === BigInt(feeAction.token),
  );
  assertSufficientPrivateBalance([...sameTokenSpend, feeAction], balances);
};

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
 * Validates a dapp action batch, obtains the exact private relay fee plan, and
 * confirms the plan remains payable before anything is shown for approval.
 */
export const quoteStrk20Actions = async (
  service: Strk20Service,
  input: Strk20AccountContext & { readonly actions: readonly Strk20Action[] },
): Promise<Strk20SubmissionPlan> => {
  await assertActionBatch(service, input);
  const plan = await service.quoteActions(input);
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
    readonly plan: Strk20SubmissionPlan;
  },
): Promise<{ readonly transactionHash: string }> => {
  await assertActionBatch(service, input);
  await assertFeeBalance(service, input);
  return service.submitActions(input);
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
 * Converts a wire INVOKE_CALL into the starknet.js call shape.
 */
export const strk20CallToInvoke = (call: Strk20InvokeCall): Call => ({
  calldata: [...call.calldata],
  contractAddress: call.contract_address,
  entrypoint: call.entry_point,
});
