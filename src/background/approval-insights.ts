/**
 * Enriches pending dapp connection approvals with per-origin phishing and
 * site-reputation insights so the approval card can warn the user before they
 * grant access. Reputation context (first-seen timestamp, current time) comes
 * from the injected origin-history store; the pure blocklist decides the text.
 */
import { originInsights } from "../security/blocklist";
import type { OriginHistoryStore } from "../storage/origin-history";
import type { PendingApproval } from "./approvals";

/**
 * Attaches `blocked` and `insights` to each pending approval. Pending approvals
 * are never for already-connected origins, so `connected` is always false here.
 */
export const enrichApprovals = async (
  approvals: readonly PendingApproval[],
  history: OriginHistoryStore,
): Promise<readonly PendingApproval[]> =>
  Promise.all(
    approvals.map(async (approval) => {
      const firstSeenAt = await history.firstSeen(approval.origin);
      const insight = originInsights(approval.origin, {
        connected: false,
        firstSeenAt,
        now: history.now(),
      });
      return {
        ...approval,
        blocked: insight.blocked,
        insights: insight.warnings,
      };
    }),
  );
