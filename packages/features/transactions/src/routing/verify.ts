/**
 * Pre-sign verification policy: turns the decoded calls from
 * @bramble/transactions/verify-decode into the risk flags the review card
 * shows, and refuses the one flag that is an
 * enforcement point rather than an annotation. Pure and network-free so every
 * rule is unit-testable.
 *
 * Trust boundary: the calls are untrusted (a dapp request, an aggregator build,
 * or a frozen multisig intent). Every authority-granting selector the wallet
 * knows about is decoded into its own {@link DecodedCall} kind first, so a rule
 * here never has to infer a grant from a summary string, and an unrecognized
 * call is reported as opaque rather than as safe.
 */

import { UNLIMITED_ALLOWANCE_THRESHOLD } from "@bramble/transactions/allowance-discovery";
import { AVNU_MULTI_ROUTE_SWAP } from "@bramble/wallet-model/avnu-route";
import { asFelt, sameFelt } from "@bramble/wallet-model/networks";
import type { Call } from "starknet";
import {
  canonical,
  type DecodedCall,
  decodeCall,
  readAddressAt,
  readUint256At,
  recipientForFlags,
  shortAddress,
  tokenFor,
  type VerificationContext,
} from "./verify-decode";
import { isDecreaseAllowanceEntrypoint } from "./verify-selectors";

/**
 * The decoded-call surface, re-exported so every consumer of the reviewer keeps
 * one import path for "what does this call do" and "how risky is it".
 */
export type {
  DecodedCall,
  DecodedCallKind,
  VerificationContext,
} from "./verify-decode";
/**
 * The trusted-set builder, re-exported for the same reason.
 */
export {
  isWatchedNftContract,
  verificationContext,
} from "./verify-decode";

/**
 * Risk flag codes surfaced on the review step.
 */
export type RiskFlagCode =
  | "address-poisoning"
  | "foreign-beneficiary"
  | "operator-approval"
  | "self-transfer"
  | "undecoded-swap"
  | "unknown-contract"
  | "unlimited-approval";

/**
 * One reviewable risk with a user-facing explanation.
 */
export type RiskFlag = {
  readonly code: RiskFlagCode;
  readonly message: string;
};

/**
 * Full pre-sign verification report.
 */
export type VerificationReport = {
  readonly calls: readonly DecodedCall[];
  readonly flags: readonly RiskFlag[];
};

/**
 * The one recipient policy every send line applies: a recipient that visually
 * mimics an address this wallet trusts is refused, not merely annotated.
 *
 * Returns the refusal — the verifier's own wording, so the user reads the same
 * sentence whichever screen they came from — or `null` when the report raises no
 * poisoning flag. Callers must treat a non-null result as "do not submit,
 * prepare, or queue this transaction"; that is what makes the check an
 * enforcement point rather than an advisory notice, and it is deliberately the
 * only flag that refuses: `self-transfer` is ordinary for a shield, an unshield,
 * or a consolidation, `unknown-contract` is a statement about the contract the
 * user chose, and an approval flag describes authority the user may genuinely
 * intend to grant.
 */
export const refuseOnPoisonedRecipient = (
  report: VerificationReport,
): { readonly error: string } | null => {
  const poisoning = report.flags.find((flag) => flag.code === "address-poisoning");
  return poisoning ? { error: poisoning.message } : null;
};

/**
 * Refuses a dapp call directed at the acting account contract itself.
 *
 * Account self-calls can change owners, guardians, implementations, or other
 * signing authority. Until each supported account ABI has an exact privileged
 * review flow, a generic dapp approval must never authorize one. Felt aliases
 * compare numerically so leading-zero spellings cannot bypass the boundary.
 */
export const refuseOnAccountSelfCall = (
  calls: readonly Call[],
  accountAddress: string,
): { readonly error: string } | null =>
  calls.some((call) => sameFelt(call.contractAddress, accountAddress))
    ? { error: "Dapps cannot call the wallet account contract itself" }
    : null;

/**
 * Detects address poisoning: a candidate that visually mimics a trusted
 * address (same leading and trailing digits) while being a different account.
 */
export const isLookalikeAddress = (candidate: string, trusted: string): boolean => {
  const left = canonical(candidate);
  const right = canonical(trusted);
  return left !== right && shortAddress(left) === shortAddress(right);
};

// Each rule is a pure predicate returning the flag it raises or null; the
// assembled list is filtered so absent rules simply drop out (see flagsForCall).
const unknownContractFlag = (call: Call, known: boolean): RiskFlag | null =>
  known
    ? null
    : {
        code: "unknown-contract",
        message: `${shortAddress(canonical(call.contractAddress))} is not a token or contact this wallet knows. Verify the contract before continuing.`,
      };

const UNLIMITED_APPROVAL_FLAG: RiskFlag = {
  code: "unlimited-approval",
  message:
    "This grants an effectively unlimited spending allowance. Approve only the amount you intend to spend.",
};

// An operator approval is the widest grant a token contract can express: it is
// not capped by an amount at all, it covers items the account does not even own
// yet, and it stands until it is explicitly revoked. It therefore gets its own
// flag rather than reusing the unlimited-approval wording, which talks about an
// amount the user could have chosen differently.
const OPERATOR_APPROVAL_FLAG: RiskFlag = {
  code: "operator-approval",
  message:
    "This lets one address transfer EVERY item you own in this collection, including ones you acquire later, until you revoke it. Grant it only to a marketplace you trust.",
};

// Which calls hand out authority so wide that no amount bounds it. Decided from
// the decoded kind and the `approved` flag in calldata, never from the
// selector's spelling alone.
const operatorApprovalCallIndexes = (
  calls: readonly Call[],
  decoded: readonly DecodedCall[],
): ReadonlySet<number> => {
  const flagged = new Set<number>();
  for (const [index, call] of calls.entries()) {
    const calldata = Array.isArray(call.calldata) ? call.calldata : [];
    const approved = asFelt(calldata[1]);
    if (decoded[index]?.kind === "operator-approval" && approved !== null && approved !== 0n) {
      flagged.add(index);
    }
  }
  return flagged;
};

/**
 * The one spelling of the `(token, spender)` pair a standing ERC20 allowance
 * belongs to. Exported so a caller assembling {@link StandingAllowances} keys it
 * exactly as the running total below reads it — two spellings of one pair would
 * silently contribute nothing.
 */
export const allowancePairKey = (token: string, spender: string): string =>
  JSON.stringify([canonical(token), canonical(spender)]);

/**
 * Allowances that already stand on chain, in base units, keyed by
 * {@link allowancePairKey}.
 *
 * Trust boundary: these are the wallet's OWN records of grants it made or read,
 * never a figure a dapp supplied, and the verifier stays network-free — it only
 * reads what a caller that does hold that knowledge hands it. A caller may
 * supply only pairs whose contract it can classify as fungible; an ERC721 item
 * id supplied here would be added to an amount and could invent a warning. An
 * omitted or understated pair only costs a flag; an over-stated one costs an
 * over-warning on a card that refuses nothing, which is the direction this rule
 * is allowed to be wrong in.
 */
export type StandingAllowances = ReadonlyMap<string, bigint>;

// The `(token, spender)` pair a call moves an allowance for and the amount it
// names, or null when its calldata carries neither. One reading for the grants
// and the withdrawals, because they share the `(spender, amount_low,
// amount_high)` shape and a running total that read them differently would be
// summing figures taken two ways.
const allowanceMovement = (
  call: Call,
): { readonly amount: bigint; readonly key: string } | null => {
  const calldata = Array.isArray(call.calldata) ? call.calldata : [];
  const spender = readAddressAt(calldata, 0);
  const amount = readUint256At(calldata, 1, 2);
  return spender && amount !== null
    ? { amount, key: allowancePairKey(call.contractAddress, spender) }
    : null;
};

// Where one call leaves the running total for its pair, and whether it is a
// GRANT (the only kind that may raise the flag). Null for a call that moves no
// allowance the wallet can read as an amount. A decrease is applied but never
// grants: on a pair that already stands above the threshold, flagging the call
// that lowers it would warn about the withdrawal instead of the grant.
const allowanceStep = (
  call: Call,
  decoded: DecodedCall | undefined,
  standingHere: bigint,
  moved: { readonly amount: bigint },
): { readonly grants: boolean; readonly total: bigint } | null => {
  if (isDecreaseAllowanceEntrypoint(call.entrypoint)) {
    return {
      grants: false,
      total: standingHere > moved.amount ? standingHere - moved.amount : 0n,
    };
  }
  if (decoded?.kind !== "approve") {
    return null;
  }
  // `approve` states the new allowance outright, so it REPLACES the standing
  // amount rather than adding to it — seeding must not turn a call that lowers a
  // grant into a warning about the grant it replaced.
  return {
    grants: true,
    total: call.entrypoint === "approve" ? moved.amount : standingHere + moved.amount,
  };
};

// Every allowance-granting call in one transaction is judged against the total
// it builds, not in isolation: `approve` replaces the standing allowance while
// an increase adds to it, so three `increase_allowance(spender, 2^127)` calls in
// one multicall grant an effectively unlimited allowance that no single call
// reaches. Per-call thresholding therefore let a drainer split its grant and
// raise no flag at all. Returns the call indexes whose running total for their
// (token, spender) pair crosses the threshold. The total starts at whatever the
// caller could tell us already stands for that pair (nothing, for a caller with
// no allowance knowledge): a one-wei increase on top of a 2^128-1 allowance
// crosses the threshold on chain, and a total that started at zero read it as
// one wei and said nothing. Only `approve`-kind calls raise the flag: an ERC721
// approval's second argument is a token id, and thresholding an id would raise
// an unlimited-spend warning about a collectible with a large number.
//
// A `decrease_allowance` in the same transaction is subtracted, in call order,
// even though it grants nothing and is never flagged itself. It has to be: a
// multicall executes atomically, so a decrease that precedes an increase has
// already lowered what that increase builds on, and a seeded total that ignored
// it would warn about a cap the transaction as a whole never reaches. Clamped at
// zero — a decrease larger than the standing allowance reverts on chain, taking
// the whole multicall with it.
const unlimitedApprovalCallIndexes = (
  calls: readonly Call[],
  decoded: readonly DecodedCall[],
  standing: StandingAllowances,
): ReadonlySet<number> => {
  const totals = new Map<string, bigint>(standing);
  const flagged = new Set<number>();
  for (const [index, call] of calls.entries()) {
    const moved = allowanceMovement(call);
    const step = moved && allowanceStep(call, decoded[index], totals.get(moved.key) ?? 0n, moved);
    if (!moved || !step) {
      continue;
    }
    totals.set(moved.key, step.total);
    if (step.grants && step.total >= UNLIMITED_ALLOWANCE_THRESHOLD) {
      flagged.add(index);
    }
  }
  return flagged;
};

const selfTransferFlag = (recipient: string, context: VerificationContext): RiskFlag | null =>
  recipient && sameFelt(recipient, context.account.address)
    ? { code: "self-transfer", message: "The recipient is this wallet's own address." }
    : null;

const addressPoisoningFlag = (recipient: string, context: VerificationContext): RiskFlag | null => {
  if (!recipient) {
    return null;
  }
  const trusted = [context.account.address, ...context.addressBook.map((entry) => entry.address)];
  return trusted.some((known) => isLookalikeAddress(recipient, known))
    ? {
        code: "address-poisoning",
        message:
          "The recipient closely mimics one of your saved addresses but is a different account. Re-check every character before sending.",
      }
    : null;
};

// A swap that pays its proceeds anywhere but the signing account is how a
// connected page takes the whole output of a swap the user approves, behind a
// line naming the genuine router. Read from the selector's beneficiary felt,
// not from the decode, so it still fires on a span the decoder refused.
const foreignBeneficiaryFlag = (
  beneficiary: string,
  context: VerificationContext,
): RiskFlag | null =>
  beneficiary && !sameFelt(beneficiary, context.account.address)
    ? {
        code: "foreign-beneficiary",
        message: `This swap pays its proceeds to ${shortAddress(canonical(beneficiary))}, not to this account. Reject it unless you meant to send them there.`,
      }
    : null;

const UNDECODED_SWAP_FLAG: RiskFlag = {
  code: "undecoded-swap",
  message:
    "The wallet could not read this swap's payee or minimum output. Reject it unless you trust this site.",
};

// The payee rules for one call. A swap into the signing account is the ordinary
// case, so on the swap selector the self-send note gives way to the
// foreign-beneficiary warning and, when the pinned decoder refused the span, to
// the flag saying the payee and floor were never shown. Poisoning applies to
// every selector that names a payee.
const recipientFlags = (
  call: Call,
  decoded: DecodedCall,
  recipient: string,
  context: VerificationContext,
): readonly (RiskFlag | null)[] =>
  call.entrypoint === AVNU_MULTI_ROUTE_SWAP
    ? [
        decoded.kind === "swap" ? null : UNDECODED_SWAP_FLAG,
        foreignBeneficiaryFlag(recipient, context),
        addressPoisoningFlag(recipient, context),
      ]
    : [selfTransferFlag(recipient, context), addressPoisoningFlag(recipient, context)];

// `unlimitedApproval` and `operatorApproval` are decided across the whole
// transaction rather than from this call alone, so a grant split into several
// increases still raises the flag on the call that completes it.
const flagsForCall = (
  call: Call,
  decoded: DecodedCall,
  context: VerificationContext,
  raised: { readonly operatorApproval: boolean; readonly unlimitedApproval: boolean },
): readonly RiskFlag[] => {
  const calldata = Array.isArray(call.calldata) ? call.calldata : [];
  // A watched NFT collection is a contract this wallet knows, even though it is
  // not in the token registry, so it does not raise the unknown-contract flag —
  // its own approval flags describe the risk precisely.
  const known =
    tokenFor(context.tokens, call.contractAddress) !== undefined ||
    decoded.kind === "nft-approval" ||
    context.knownContracts?.some((contract) => sameFelt(contract, call.contractAddress)) === true;
  const recipient = recipientForFlags(call, calldata);
  const candidates: readonly (RiskFlag | null)[] = [
    unknownContractFlag(call, known),
    raised.unlimitedApproval ? UNLIMITED_APPROVAL_FLAG : null,
    raised.operatorApproval ? OPERATOR_APPROVAL_FLAG : null,
    ...recipientFlags(call, decoded, recipient, context),
  ];
  return candidates.filter((flag): flag is RiskFlag => flag !== null);
};

const dedupeFlags = (flags: readonly RiskFlag[]): readonly RiskFlag[] => {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    // Key on code *and* message, not code alone: two flags that render to the
    // same user-facing line are redundant, but distinct lines must all survive.
    // A multicall touching two different unknown contracts raises two
    // `unknown-contract` flags naming each address — collapsing by code would
    // silently hide every contract after the first.
    const key = JSON.stringify([flag.code, flag.message]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * Verifies calls against wallet context: decoded summaries plus risk flags.
 * Every call is decoded independently, but the unlimited-approval rule is
 * evaluated over the whole call list so an allowance split across several
 * `increase_allowance` calls is judged on its total. Pure: unrecognized or
 * malformed calldata yields an opaque summary rather than an invented one, and
 * no rule ever consults the network.
 *
 * `standing` is what the CALLER knows already stands on chain for a
 * `(token, spender)` pair, so an increase that crosses the unlimited threshold
 * only because of the allowance beneath it is still flagged. Omitting it keeps
 * the network-free reading — every total starts at zero — which under-counts and
 * can therefore only miss a flag, never raise one.
 *
 * Supplying it moves the error the other way: a starting total is a record of a
 * grant that was made, not a live balance, so a spender that has since consumed
 * part of it leaves that figure over-stating what stands, and the rule may warn
 * about a cap the account no longer has. That is the direction this rule is allowed to be
 * wrong in — `unlimited-approval` is an annotation on the review card and
 * nothing refuses on it, unlike `address-poisoning`. See
 * {@link StandingAllowances} for what a caller may supply.
 */
export const verifyCalls = (
  calls: readonly Call[],
  context: VerificationContext,
  standing: StandingAllowances = new Map(),
): VerificationReport => {
  const decoded = calls.map((call) => decodeCall(call, context));
  const unlimited = unlimitedApprovalCallIndexes(calls, decoded, standing);
  const operator = operatorApprovalCallIndexes(calls, decoded);
  const flags = calls.flatMap((call, index) => {
    const decodedCall = decoded[index];
    return decodedCall
      ? flagsForCall(call, decodedCall, context, {
          operatorApproval: operator.has(index),
          unlimitedApproval: unlimited.has(index),
        })
      : [];
  });
  return { calls: decoded, flags: dedupeFlags(flags) };
};
