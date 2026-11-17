/**
 * What a co-owner is shown before signing a pool CallSet or a relay digest.
 * Every line is decoded from what the digest covers: the pool call, its
 * actions, the token and amount in that token's decimals, and the recipient,
 * plus the account and network the digest is bound to. A sender's label is
 * never rendered, and anything that does not decode returns null so it cannot
 * be signed.
 */

import { sameFelt } from "@bramble/wallet-model/networks";
import {
  decodeMultisigStrk20CompileActions,
  type MultisigStrk20PoolAction,
} from "./pool-call-decode";
import type { MultisigStrk20ActionRequest } from "./records";
import { restoreStrk20Calldata } from "./redaction";
import {
  type MultisigStrk20Review,
  type MultisigStrk20ReviewScope,
  reviewAmount,
  reviewScopeLines,
} from "./review-scope";

/**
 * The summary this wallet writes for an action it proved. A co-owner's screen
 * does not render it; the calls do.
 */
export const multisigStrk20Summary = (kind: MultisigStrk20ActionRequest["kind"]): string =>
  kind === "register"
    ? "Register this multisig's private balance"
    : kind === "deposit"
      ? "Deposit into this multisig's private balance"
      : kind === "withdraw"
        ? "Withdraw from this multisig's private balance"
        : "Transfer from this multisig's private balance";

const party = (recipient: string, scope: MultisigStrk20ReviewScope): string =>
  sameFelt(recipient, scope.accountAddress) ? "this multisig" : recipient;

const actionLine = (
  action: MultisigStrk20PoolAction,
  scope: MultisigStrk20ReviewScope,
): string | null | undefined => {
  if (action.kind === "setup") return undefined;
  if (action.kind === "register") return multisigStrk20Summary("register");
  const value = reviewAmount(action.token, action.amount, scope.tokens);
  if (!value) return null;
  if (action.kind === "deposit") return `Deposit ${value}`;
  if (action.kind === "withdraw") return `Withdraw ${value} to ${party(action.recipient, scope)}`;
  return sameFelt(action.recipient, scope.accountAddress)
    ? `Keep ${value} in this multisig`
    : `Send ${value} to ${action.recipient}`;
};

/**
 * One CallSet as the signer should read it. Returns null unless it is exactly
 * one `compile_actions` call on the configured pool, for this account and
 * this scalar, whose actions all decode against tracked tokens.
 */
export const reviewMultisigStrk20Calls = (
  calls: readonly {
    readonly calldata: readonly string[];
    readonly contractAddress: string;
    readonly entrypoint: string;
  }[],
  scalar: string,
  scope: MultisigStrk20ReviewScope,
): MultisigStrk20Review | null => {
  const [call] = calls;
  if (
    calls.length !== 1 ||
    !call ||
    call.entrypoint !== "compile_actions" ||
    !sameFelt(call.contractAddress, scope.poolAddress)
  ) {
    return null;
  }
  const calldata = restoreStrk20Calldata(call.calldata, scalar);
  const actions = calldata
    ? decodeMultisigStrk20CompileActions(calldata, scope.accountAddress, scalar)
    : null;
  if (!actions) return null;
  const lines: string[] = [];
  for (const action of actions) {
    const line = actionLine(action, scope);
    if (line === null) return null;
    if (line !== undefined) lines.push(line);
  }
  if (lines.length === 0) return null;
  return { lines: [...reviewScopeLines(scope), ...lines], title: "Privacy pool · compile_actions" };
};

/**
 * The relay this device proved, before Send. Returns null unless its call is
 * `apply_actions` on the configured pool and the action and fee tokens are
 * tracked. The request is this device's own; it never arrives from a co-owner.
 */
export const reviewMultisigStrk20Relay = (
  relay: {
    readonly call: { readonly contractAddress: string; readonly entrypoint: string };
    readonly feeAction: { readonly amount: string; readonly token: string };
    readonly request: MultisigStrk20ActionRequest;
  },
  scope: MultisigStrk20ReviewScope,
): MultisigStrk20Review | null => {
  const { call, feeAction, request } = relay;
  if (call.entrypoint !== "apply_actions" || !sameFelt(call.contractAddress, scope.poolAddress)) {
    return null;
  }
  if (
    (request.kind !== "transfer" && request.kind !== "withdraw") ||
    !request.token ||
    !request.amount ||
    !request.recipient
  ) {
    return null;
  }
  const value = reviewAmount(request.token, BigInt(request.amount), scope.tokens);
  const fee = reviewAmount(feeAction.token, BigInt(feeAction.amount), scope.tokens);
  if (!value || !fee) return null;
  const action =
    request.kind === "transfer"
      ? `Send ${value} to ${request.recipient}`
      : `Withdraw ${value} to ${party(request.recipient, scope)}`;
  return {
    lines: [...reviewScopeLines(scope), action, `Relay fee ${fee}`],
    title: "Privacy pool · apply_actions",
  };
};

/** The scope and card types every multisig STRK20 review shares. */
export type {
  MultisigStrk20Review,
  MultisigStrk20ReviewScope,
  MultisigStrk20ReviewToken,
} from "./review-scope";
/** Relay typed-data review; see `./typed-review`. */
export { reviewMultisigStrk20TypedData } from "./typed-review";
