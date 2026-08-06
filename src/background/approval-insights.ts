/**
 * Enriches pending dapp connection approvals with per-origin phishing and
 * site-reputation insights so the approval card can warn the user before they
 * grant access. Reputation context (first-seen timestamp, current time) comes
 * from the injected origin-history store; the pure blocklist decides the text.
 */
import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "../security/blocklist";
import type { OriginHistoryStore } from "../storage/origin-history";
import type { PendingApproval } from "./approvals";

/**
 * Attaches `blocked` and `insights` to each pending approval. Privacy and
 * transaction approvals may come from an already-connected origin; the
 * reputation layer still treats the pending action as a fresh trust decision.
 *
 * First-seen history is read *before* being recorded, so the very first time an
 * origin surfaces a prompt it is correctly reported as never-before-seen; the
 * record then persists it so later prompts reflect the real history. This keeps
 * the "first time seen" reputation branch reachable instead of dead.
 */
export const enrichApprovals = async (
  approvals: readonly PendingApproval[],
  history: OriginHistoryStore,
  guard: OriginGuard = DEFAULT_ORIGIN_GUARD,
): Promise<readonly PendingApproval[]> =>
  Promise.all(
    approvals.map(async (approval) => {
      const firstSeenAt = await history.firstSeen(approval.origin);
      const insight = guard.insights(approval.origin, {
        connected: false,
        firstSeenAt,
        now: history.now(),
      });
      await history.record(approval.origin);
      return {
        ...approval,
        blocked: insight.blocked,
        insights: insight.warnings,
      };
    }),
  );
