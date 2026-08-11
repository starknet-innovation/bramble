/**
 * Pre-sign verification policy: turns the decoded calls from ./verify-decode
 * into the risk flags the review card shows, and refuses the one flag that is an
 * enforcement point rather than an annotation. Pure and network-free so every
 * rule is unit-testable.
 *
 * Trust boundary: the calls are untrusted (a dapp request, an aggregator build,
 * or a stored multisig proposal). Every authority-granting selector the wallet
 * knows about is decoded into its own {@link DecodedCall} kind first, so a rule
 * here never has to infer a grant from a summary string, and an unrecognized
 * call is reported as opaque rather than as safe.
 */
import type { Call } from "starknet";
import { UNLIMITED_ALLOWANCE_THRESHOLD } from "./allowance-discovery";
import { asFelt, sameFelt } from "./networks";
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

/**
 * The decoded-call surface, re-exported so every consumer of the reviewer keeps
 * one import path for "what does this call do" and "how risky is it".
 */
export type { DecodedCall, DecodedCallKind, VerificationContext } from "./verify-decode";
/**
 * The trusted-set builder, re-exported for the same reason.
 */
export { isWatchedNftContract, verificationContext } from "./verify-decode";

/**
 * Risk flag codes surfaced on the review step.
 */
export type RiskFlagCode =
  | "address-poisoning"
  | "operator-approval"
  | "self-transfer"
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
 * Detects address poisoning: a candidate that visually mimics a trusted
 * address (same leading and trailing digits) while being a different account.
 */
export const isLookalikeAddress = (candidate: string, trusted: string): boolean => {
  const left = canonical(candidate);
  const right = canonical(trusted);
  if (left === right || left.length < 14 || right.length < 14) {
    return false;
  }
  return left.slice(0, 8) === right.slice(0, 8) && left.slice(-4) === right.slice(-4);
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

// Every allowance-granting call in one transaction is judged against the total
// it builds, not in isolation: `approve` replaces the standing allowance while
// an increase adds to it, so three `increase_allowance(spender, 2^127)` calls in
// one multicall grant an effectively unlimited allowance that no single call
// reaches. Per-call thresholding therefore let a drainer split its grant and
// raise no flag at all. Returns the call indexes whose running total for their
// (token, spender) pair crosses the threshold; the running total starts at zero
// because the verifier is network-free and cannot know what the token already
// allows — an under-count that can only miss a flag, never invent one. Only
// `approve`-kind calls count: an ERC721 approval's second argument is a token
// id, and thresholding an id would raise an unlimited-spend warning about a
// collectible with a large number.
const unlimitedApprovalCallIndexes = (
  calls: readonly Call[],
  decoded: readonly DecodedCall[],
): ReadonlySet<number> => {
  const totals = new Map<string, bigint>();
  const flagged = new Set<number>();
  for (const [index, call] of calls.entries()) {
    const calldata = Array.isArray(call.calldata) ? call.calldata : [];
    const spender = readAddressAt(calldata, 0);
    const amount = readUint256At(calldata, 1, 2);
    if (decoded[index]?.kind !== "approve" || !spender || amount === null) {
      continue;
    }
    const key = JSON.stringify([canonical(call.contractAddress), canonical(spender)]);
    const total = call.entrypoint === "approve" ? amount : (totals.get(key) ?? 0n) + amount;
    totals.set(key, total);
    if (total >= UNLIMITED_ALLOWANCE_THRESHOLD) {
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
    tokenFor(context.tokens, call.contractAddress) !== undefined || decoded.kind === "nft-approval";
  const recipient = recipientForFlags(call, calldata, decoded);
  const candidates: readonly (RiskFlag | null)[] = [
    unknownContractFlag(call, known),
    raised.unlimitedApproval ? UNLIMITED_APPROVAL_FLAG : null,
    raised.operatorApproval ? OPERATOR_APPROVAL_FLAG : null,
    selfTransferFlag(recipient, context),
    addressPoisoningFlag(recipient, context),
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
 */
export const verifyCalls = (
  calls: readonly Call[],
  context: VerificationContext,
): VerificationReport => {
  const decoded = calls.map((call) => decodeCall(call, context));
  const unlimited = unlimitedApprovalCallIndexes(calls, decoded);
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
