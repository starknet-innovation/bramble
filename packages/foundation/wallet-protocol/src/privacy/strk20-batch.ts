/**
 * Batch-level STRK20 checks that run before a dapp's private request reaches
 * the approval queue (mc-wallet #443, PR 3). Each action is already
 * schema-valid; these refuse combinations the pinned SDK or the pool is known
 * to reject only after the user has approved, or where the call the user
 * reviews is not the call that runs. Pure: no chain reads, no secret material.
 *
 * Evidence, at the pinned privacy revision (`b40bf10`):
 * - the SDK allows one invoke-phase action per transaction (`compiler.ts`);
 * - the SDK turns a sub-account call's `entry_point` into a selector with
 *   `getSelectorFromName`, so a `0x…` value is hashed as if it were a name
 *   (`shadow-accounts.ts`);
 * - the pool rejects a transaction that leaves an open note undeposited
 *   (`UNDEPOSITED_OPEN_NOTES`) and applies actions in order, so a deposit into
 *   an open note created later fails;
 * - the anonymizer takes at most one open note per token;
 * - a public deposit screens the depositor while a `Delegated` sub-account
 *   deposit into open notes screens the sub-account, and one transaction may
 *   have only one screening subject (`MULTIPLE_SCREENING_SUBJECTS`).
 */
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { OPEN_AMOUNT, type Strk20Action } from "./strk20";

/**
 * Prefix of every batch refusal. The background returns it as an `invalid …`
 * error, which the provider maps to INVALID_REQUEST_PAYLOAD (114), carrying the
 * reason after the prefix as the error's `data`.
 */
export const STRK20_BATCH_REFUSAL_PREFIX = "invalid strk20 action batch: ";

/** Why a STRK20 batch is refused before approval. Dapp-facing protocol text. */
export const STRK20_BATCH_REFUSALS = {
  entryPointSelector:
    "subaccount_invoke call entry_point must be a function name; a 0x selector would be hashed as a name and call a different function",
  multipleInvokes: "a batch may contain at most one invoke or subaccount_invoke action",
  multipleScreeningSubjects:
    "a public deposit cannot share a batch with a subaccount_invoke that settles OPEN transfers (MULTIPLE_SCREENING_SUBJECTS)",
  openAfterInvoke: "every OPEN transfer must come before the invoke or subaccount_invoke action",
  openPerToken: "a subaccount_invoke settles at most one OPEN transfer per token",
  openWithoutInvoke:
    "an OPEN transfer needs an invoke or subaccount_invoke action in the same batch to fill it",
} as const;

const SELECTOR_PATTERN = /^0x/i;

const isInvokeType = (action: Strk20Action): boolean =>
  action.type === "invoke" || action.type === "subaccount_invoke";

const isOpenTransfer = (action: Strk20Action): boolean =>
  action.type === "transfer" && action.amount === OPEN_AMOUNT;

const hasRepeatedToken = (actions: readonly Strk20Action[]): boolean => {
  const tokens = actions.flatMap((action) =>
    "token" in action ? [canonicalFelt(action.token) ?? action.token] : [],
  );
  return new Set(tokens).size !== tokens.length;
};

/**
 * Returns the reason a schema-valid STRK20 action batch must be refused before
 * approval, or null when none of the known pre-approval rules applies. A null
 * result is not a promise the batch will prove or settle: balances, screening
 * policies, and the prover are checked later.
 */
export const strk20BatchRefusal = (
  actions: readonly Strk20Action[],
): keyof typeof STRK20_BATCH_REFUSALS | null => {
  const invokeIndexes = actions.flatMap((action, index) => (isInvokeType(action) ? [index] : []));
  if (invokeIndexes.length > 1) return "multipleInvokes";
  const invokeIndex = invokeIndexes[0];
  const invoke = invokeIndex === undefined ? undefined : actions[invokeIndex];
  if (
    invoke?.type === "subaccount_invoke" &&
    invoke.calls.some((call) => SELECTOR_PATTERN.test(call.entry_point))
  ) {
    return "entryPointSelector";
  }
  const openIndexes = actions.flatMap((action, index) => (isOpenTransfer(action) ? [index] : []));
  if (openIndexes.length === 0) return null;
  if (invokeIndex === undefined) return "openWithoutInvoke";
  if (openIndexes.some((index) => index > invokeIndex)) return "openAfterInvoke";
  if (invoke?.type !== "subaccount_invoke") return null;
  if (hasRepeatedToken(actions.filter(isOpenTransfer))) return "openPerToken";
  return actions.some((action) => action.type === "deposit") ? "multipleScreeningSubjects" : null;
};

/**
 * The background's error string for a refused batch: the shared prefix plus the
 * reason, or null when the batch passes {@link strk20BatchRefusal}.
 */
export const strk20BatchRefusalError = (actions: readonly Strk20Action[]): string | null => {
  const refusal = strk20BatchRefusal(actions);
  return refusal === null
    ? null
    : `${STRK20_BATCH_REFUSAL_PREFIX}${STRK20_BATCH_REFUSALS[refusal]}`;
};
