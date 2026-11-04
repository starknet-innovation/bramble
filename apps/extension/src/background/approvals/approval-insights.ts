/**
 * Enriches pending dapp connection approvals with per-origin phishing and
 * site-reputation insights so the approval card can warn the user before they
 * grant access. Reputation context (first-seen timestamp, current time) comes
 * from the injected origin-history store; the pure blocklist decides the text.
 * The app directory (mc-wallet issue 749) adds its listing, a delisting
 * warning, and a flag when a listed app calls a contract its listing does not
 * declare. Each is decided here from the queued request's origin, which the
 * background took from the validated sender, never from anything the page
 * says about itself.
 */
import { APP_DIRECTORY, type AppDirectory } from "@bramble/permissions/app-directory";
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import type { OriginHistoryStore } from "@bramble/permissions/origin-history";
import type { PendingApproval } from "./approvals";

/** The warning on a request from an origin the app directory delisted. */
export const DELISTED_APP_WARNING =
  "Bramble removed this site from its app directory. Check it before you continue.";

/** The warning when a listed app calls a contract its listing leaves out. */
export const UNDECLARED_CONTRACT_WARNING =
  "This request calls a contract that isn't in this site's app directory listing.";

const directoryInsights = (
  approval: PendingApproval,
  directory: AppDirectory,
): Partial<PendingApproval> => {
  if (directory.revoked(approval.origin)) return { insights: [DELISTED_APP_WARNING] };
  const listed = directory.listing(approval.origin);
  if (!listed) return {};
  const networkId = approval.context?.networkId;
  const called = approval.callReviews?.map((call) => call.contractAddress) ?? [];
  const undeclared =
    networkId === undefined
      ? []
      : directory.undeclaredContracts(approval.origin, networkId, called);
  return {
    listing: listed.name,
    ...(undeclared.length === 0 ? {} : { insights: [UNDECLARED_CONTRACT_WARNING] }),
  };
};

/**
 * Attaches `blocked`, `insights` and, for a listed origin, `listing` to each
 * pending approval. Privacy and transaction approvals may come from an
 * already-connected origin; the reputation layer still treats the pending
 * action as a fresh trust decision.
 *
 * Listing is read-only: the origin becomes seen only when the user decides the
 * prompt, so ambient panel polling cannot weaken the warning mid-review.
 */
export const enrichApprovals = async (
  approvals: readonly PendingApproval[],
  history: OriginHistoryStore,
  guard: OriginGuard = DEFAULT_ORIGIN_GUARD,
  directory: AppDirectory = APP_DIRECTORY,
): Promise<readonly PendingApproval[]> =>
  Promise.all(
    approvals.map(async (approval) => {
      const firstSeenAt = await history.firstSeen(approval.origin);
      const insight = guard.insights(approval.origin, {
        connected: false,
        firstSeenAt,
        now: history.now(),
      });
      const listed = directoryInsights(approval, directory);
      return {
        ...approval,
        blocked: insight.blocked,
        insights: [...(listed.insights ?? []), ...insight.warnings],
        // A blocked origin is never shown as listed, whatever the directory says.
        ...(listed.listing === undefined || insight.blocked ? {} : { listing: listed.listing }),
      };
    }),
  );
