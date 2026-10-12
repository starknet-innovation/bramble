/**
 * Whether a queued approval fits the side panel, decided only from what the
 * requesting site controls.
 *
 * The panel reads each queued approval under the provider budget and drops one
 * that exceeds it, so a larger approval is refused at enqueue (Sherlock 157).
 * But part of every approval is written by the wallet from the user's own data:
 * risk flags such as the lookalike-recipient warning, summaries that read a
 * tracked token's ticker, the tracked tokens a card names, the account context.
 * Measuring the whole approval let a site pad its request to sit just under the
 * limit and read the user's data from the outcome: refused when a recipient is
 * flagged as mimicking a saved contact, queued when it is not.
 *
 * So the decision measures the site's part as it is, and every wallet-written
 * field at the largest the panel would accept, sized from counts the site fixes
 * (one summary per call, action or token it sends). Two users holding different
 * contacts and tokens get the same answer for the same request.
 */
import { isJsonWithinBudget, JSON_BUDGETS } from "@bramble/core/json";
import { REVIEWABLE_APPROVAL_BUDGET } from "./approval-limits";
import type { PendingApproval } from "./approval-snapshot";

// The longest summary line and flag message the panel renders (its
// `isSummaryText` and `isApprovalRiskFlag`); a longer one drops the card anyway.
const PANEL_TEXT_CHARACTERS = 300;
// Longer than every risk flag code.
const FLAG_CODE_CHARACTERS = 32;
// The verifier raises each flag code at most once per call, and summarizes each
// call in exactly one line, so a card carries at most this many flags per
// summary line. Only invoke and OutsideExecution typed data carry flags.
const FLAGS_PER_SUMMARY = 7;
const FLAGGED_KINDS: ReadonlySet<PendingApproval["kind"]> = new Set(["invoke", "sign-typed-data"]);
// `0x` and 64 hex digits; a base-units amount has at most 78 digits.
const FELT_CHARACTERS = 66;
const AMOUNT_CHARACTERS = 78;
// Longer than every token ticker the panel accepts (12 characters).
const SYMBOL_CHARACTERS = 16;
// Longer than any account id, chain id or payload digest.
const CONTEXT_CHARACTERS = 96;

// Wallet-written fields. The fee review fields are left out of the worst case:
// they are covered by the fee headroom in `REVIEWABLE_APPROVAL_BUDGET`, which
// already holds the larger review a fee estimate writes after admission.
const WALLET_FIELDS: ReadonlySet<string> = new Set([
  "context",
  "deployFirst",
  "existingGrant",
  "fee",
  "feeAffordability",
  "feeEstimateFailed",
  "feeEstimatePending",
  "flags",
  "relayFeeAction",
  "requiresDeployment",
  "reviewAssets",
  "summaries",
]);

const filler = (characters: number): string => "x".repeat(characters);

// The approval with every wallet-written field replaced by the largest value
// the panel would accept for the counts the site chose. Each real field is no
// larger in any budget dimension: no longer strings, no more elements.
const worstCaseReview = (approval: PendingApproval): Record<string, unknown> => {
  const siteFields = Object.fromEntries(
    Object.entries(approval).filter(([key]) => !WALLET_FIELDS.has(key)),
  );
  const summaries = approval.summaries ?? [];
  // One review asset per address the request names, and each call, action or
  // token named gets its own summary line.
  const lines = summaries.length;
  return {
    ...siteFields,
    ...(approval.context === undefined
      ? {}
      : {
          context: {
            accountId: filler(CONTEXT_CHARACTERS),
            chainId: filler(CONTEXT_CHARACTERS),
            networkId: filler(CONTEXT_CHARACTERS),
            payloadDigest: filler(CONTEXT_CHARACTERS),
          },
        }),
    ...(approval.kind === "connect" ? { existingGrant: false } : {}),
    ...(FLAGGED_KINDS.has(approval.kind)
      ? {
          flags: Array.from({ length: lines * FLAGS_PER_SUMMARY }, () => ({
            code: filler(FLAG_CODE_CHARACTERS),
            message: filler(PANEL_TEXT_CHARACTERS),
          })),
        }
      : {}),
    ...(approval.kind === "strk20-invoke"
      ? {
          relayFeeAction: {
            amount: filler(AMOUNT_CHARACTERS),
            recipient: filler(FELT_CHARACTERS),
            token: filler(FELT_CHARACTERS),
            type: "withdraw",
          },
        }
      : {}),
    reviewAssets: Array.from({ length: lines }, () => ({
      address: filler(FELT_CHARACTERS),
      symbol: filler(SYMBOL_CHARACTERS),
    })),
    // A line already longer than the panel renders comes from the site's own
    // strings, not the user's data; it is measured as it is.
    summaries: summaries.map((line) => filler(Math.max(line.length, PANEL_TEXT_CHARACTERS))),
  };
};

/**
 * Whether `approval` can be queued for the side panel to show (Sherlock 157),
 * decided from the requesting site's input alone (Sherlock 140).
 *
 * The second check is the panel's own limit on the approval as written. It is a
 * fail-closed backstop that the bounds above make unreachable: the real
 * approval is no larger than its worst case plus a fee review, and the fee
 * headroom covers the fee review. A wallet change that breaks one of those
 * bounds is refused here rather than queued with no card.
 */
export const fitsSidePanel = (approval: PendingApproval): boolean =>
  isJsonWithinBudget(worstCaseReview(approval), REVIEWABLE_APPROVAL_BUDGET) &&
  isJsonWithinBudget(approval, JSON_BUDGETS.provider);
