/**
 * STRK20 privacy protocol service: the read side (registration + private
 * balances) plus the shared prepare pipeline that validates a batch of actions
 * against balances, guards against a conservative privacy-leak pattern, and
 * delegates real proof generation to an injected proving backend. Balance and
 * leak checks are fully implemented and testable here; the zero-knowledge proof
 * itself is produced only by a configured {@link Strk20ProvingBackend}.
 */
import type { Call } from "starknet";
import { WalletError } from "../../shared/errors";
import type { AccountRef } from "../../storage/vault-schema";
import { type Strk20ProvingBackend, unconfiguredProvingBackend } from "./proving-backend";
import type {
  Strk20Action,
  Strk20BalanceEntry,
  Strk20CallAndProof,
  Strk20InvokeCall,
} from "./schemas";

/**
 * Stable error mapped to NOT_REGISTERED (118): the account is not enrolled in
 * the STRK20 privacy protocol.
 */
export const STRK20_NOT_REGISTERED = "account not registered in strk20";
/**
 * Stable error mapped to INSUFFICIENT_PRIVATE_BALANCE (119).
 */
export const STRK20_INSUFFICIENT_BALANCE = "insufficient private balance";
/**
 * Stable error mapped to PRIVACY_LEAK (120).
 */
export const STRK20_PRIVACY_LEAK = "strk20 privacy leak";

/**
 * The account, RPC endpoints, and prover endpoint a STRK20 read targets. A null
 * `proverUrl` means the user has not configured a prover, so the wallet treats
 * the account as unavailable rather than talking to any endpoint.
 */
export type Strk20AccountContext = {
  readonly account: AccountRef;
  readonly proverUrl: string | null;
  readonly rpcUrls: readonly string[];
};

/**
 * A private-balance query for a specific set of tokens.
 */
export type Strk20BalancesInput = Strk20AccountContext & {
  readonly tokens: readonly string[];
};

/**
 * The injectable STRK20 service surface. `registered` and `privateBalances` are
 * chain reads a real deployment implements against the protocol's registry;
 * `proving` is the isolated proof backend.
 */
export type Strk20Service = {
  readonly privateBalances: (input: Strk20BalancesInput) => Promise<readonly Strk20BalanceEntry[]>;
  readonly proving: Strk20ProvingBackend;
  readonly registered: (input: Strk20AccountContext) => Promise<boolean>;
};

/**
 * The default service used when no STRK20 backend is wired: the account is
 * treated as not registered, so read and prepare calls fail with the spec
 * NOT_REGISTERED error rather than inventing private state.
 */
export const unavailableStrk20Service: Strk20Service = {
  async privateBalances(): Promise<readonly Strk20BalanceEntry[]> {
    throw new WalletError(STRK20_NOT_REGISTERED);
  },
  proving: unconfiguredProvingBackend,
  async registered(): Promise<boolean> {
    return false;
  },
};

// Tokens whose private balance is spent (withdraw/transfer); deposits add to the
// private balance and invokes reference no token, so neither constrains balance.
const spentTokens = (actions: readonly Strk20Action[]): readonly string[] => {
  const seen = new Map<bigint, string>();
  for (const action of actions) {
    if (action.action === "withdraw" || action.action === "transfer") {
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
    if (action.action === "withdraw" || action.action === "transfer") {
      const key = BigInt(action.token);
      required.set(key, (required.get(key) ?? 0n) + BigInt(action.amount));
    }
  }
  for (const [token, amount] of required) {
    const entry = balances.find((balance) => BigInt(balance.token) === token);
    const available = entry ? BigInt(entry.balance) : 0n;
    if (amount > available) {
      throw new WalletError(STRK20_INSUFFICIENT_BALANCE);
    }
  }
};

// Conservative, deterministic leak guard: depositing and withdrawing the same
// token in one batch exposes both a public in- and out-flow for that token,
// which can be correlated on-chain. This is not a full privacy analysis — it is
// a refusal for a clearly-linkable pattern, so the wallet never claims a
// guarantee the proof cannot back.
const assertNoPrivacyLeak = (actions: readonly Strk20Action[]): void => {
  const deposits = new Set<bigint>();
  const withdrawals = new Set<bigint>();
  for (const action of actions) {
    if (action.action === "deposit") {
      deposits.add(BigInt(action.token));
    }
    if (action.action === "withdraw") {
      withdrawals.add(BigInt(action.token));
    }
  }
  for (const token of deposits) {
    if (withdrawals.has(token)) {
      throw new WalletError(STRK20_PRIVACY_LEAK);
    }
  }
};

/**
 * Reads the account's private balances for the requested tokens, failing with
 * NOT_REGISTERED when the account is not enrolled in the protocol.
 */
export const readStrk20Balances = async (
  service: Strk20Service,
  input: Strk20BalancesInput,
): Promise<readonly Strk20BalanceEntry[]> => {
  if (
    !(await service.registered({
      account: input.account,
      proverUrl: input.proverUrl,
      rpcUrls: input.rpcUrls,
    }))
  ) {
    throw new WalletError(STRK20_NOT_REGISTERED);
  }
  return service.privateBalances(input);
};

/**
 * Builds a STRK20_CALL_AND_PROOF for a validated action batch without
 * submitting it: verifies registration, checks the private balance for every
 * spending action, refuses a leaking batch, and asks the proving backend for the
 * proof. Throws the stable STRK20 errors that map to spec codes 118/119/120 (or
 * UNKNOWN_ERROR when no prover is configured).
 */
export const prepareStrk20CallAndProof = async (
  service: Strk20Service,
  input: {
    readonly account: AccountRef;
    readonly actions: readonly Strk20Action[];
    readonly proverUrl: string | null;
    readonly rpcUrls: readonly string[];
    readonly simulate: boolean;
  },
): Promise<Strk20CallAndProof> => {
  const context = {
    account: input.account,
    proverUrl: input.proverUrl,
    rpcUrls: input.rpcUrls,
  };
  if (!(await service.registered(context))) {
    throw new WalletError(STRK20_NOT_REGISTERED);
  }
  const tokens = spentTokens(input.actions);
  const balances = tokens.length > 0 ? await service.privateBalances({ ...context, tokens }) : [];
  assertSufficientPrivateBalance(input.actions, balances);
  assertNoPrivacyLeak(input.actions);
  return service.proving.prove({
    account: input.account,
    actions: input.actions,
    balances,
    proverUrl: input.proverUrl,
    rpcUrls: input.rpcUrls,
    simulate: input.simulate,
  });
};

// Shortens an address for a summary line without dropping enough to be
// ambiguous in review.
const shortAddress = (value: string): string =>
  value.length <= 13 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;

/**
 * Builds a plain, review-friendly summary of one action for the approval card.
 * Contains only values the dapp already supplied (amounts, tokens, recipients);
 * it holds no secret material and is never logged.
 */
export const summarizeStrk20Action = (action: Strk20Action): string => {
  if (action.action === "deposit") {
    return `Deposit ${action.amount} to private balance (${shortAddress(action.token)})`;
  }
  if (action.action === "withdraw") {
    return `Withdraw ${action.amount} to public balance (${shortAddress(action.token)})`;
  }
  if (action.action === "transfer") {
    return `Transfer ${action.amount} privately to ${shortAddress(
      action.recipient,
    )} (${shortAddress(action.token)})`;
  }
  return `Private invoke ${action.call.entry_point} on ${shortAddress(
    action.call.contract_address,
  )}`;
};

/**
 * Converts a spec INVOKE_CALL into the starknet-js call shape used for
 * submission.
 */
export const strk20CallToInvoke = (call: Strk20InvokeCall): Call => ({
  calldata: [...call.calldata],
  contractAddress: call.contract_address,
  entrypoint: call.entry_point,
});
