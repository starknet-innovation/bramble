/**
 * The summary bound a queued approval must meet before it is admitted.
 *
 * The panel renders an approval only when every summary line is non-empty and
 * at most {@link APPROVAL_SUMMARY_MAX_LENGTH} characters, and drops any other
 * entry so one malformed approval cannot blank the queue. An approval the panel
 * would drop was still queued here, so the site's request waited with nothing
 * on screen until it expired (Sherlock 187). The queue now refuses such an
 * approval at admission: the site gets an error at once, and the user is never
 * asked to approve a request they cannot see. Summaries are not shortened,
 * because a cut call summary can lose the fact the user is approving.
 */

import { WalletError } from "@bramble/core/errors";
import { APPROVAL_SUMMARY_MAX_LENGTH } from "@bramble/wallet-protocol/extension-responses";

/** Refusal for an approval whose summary the panel could not render. */
export const APPROVAL_SUMMARY_UNRENDERABLE = "approval summary too long to review";

/**
 * Throws {@link APPROVAL_SUMMARY_UNRENDERABLE} unless every summary line of
 * `approval` would pass the panel's bound. Approvals with no summaries pass.
 */
export const requireRenderableSummaries = (approval: {
  readonly summaries?: readonly string[];
}): void => {
  const summaries = approval.summaries ?? [];
  if (
    summaries.some(
      (summary) => summary.length === 0 || summary.length > APPROVAL_SUMMARY_MAX_LENGTH,
    )
  ) {
    throw new WalletError(APPROVAL_SUMMARY_UNRENDERABLE);
  }
};
