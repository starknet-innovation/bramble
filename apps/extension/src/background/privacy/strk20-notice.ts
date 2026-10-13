/**
 * The close-only notice a site's private request is held on when it cannot
 * reach a review card (#443). Any answer given at once — no anonymizer, a
 * full shadow-account record table, a failed fee quote — would let a site
 * probe, silently, what this user has set up. Instead the request is held on
 * the wallet's own surface with one wallet-chosen line and a Close control; the
 * site receives the refusal only when the user closes it. Unanswered, it
 * expires exactly like any other approval ("request rejected", 113), so waiting
 * out the TTL tells the site nothing a real approval card would not. Nothing
 * is signed, prepared, or disclosed on this path.
 */
import { STRK20_SERVICE_UNAVAILABLE } from "@bramble/privacy/service";
import type { Strk20NoticeReason } from "@bramble/wallet-protocol/extension-responses";
import type { ApprovalReservation } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue } from "../approvals/approvals";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { strk20ErrorMessage } from "./strk20-approval-execution";

/**
 * The refusal for a shadow-account request on a network with no anonymizer:
 * the same error the SDK adapter raises (#443).
 */
export const MISSING_ANONYMIZER_REFUSAL = `${STRK20_SERVICE_UNAVAILABLE}: no shadow account anonymizer is configured for this network`;

/**
 * Holds `origin`'s request on a notice and resolves with `refusal` once the
 * user closes it, or with the ordinary expiry refusal if it expires. `notice`
 * picks the line; absent, it is the not-set-up line. If the notice cannot be
 * queued (the queue is full), the queue's own error is returned. Given the
 * request's `admission`, the notice takes over its slot and its deadline: it
 * expires from when the request arrived, as a card would (audit N3).
 */
export const holdStrk20Notice = async (
  deps: {
    readonly approvals: ApprovalQueue;
    readonly waiters: { readonly register: (id: string) => Promise<RuntimeResponse> };
  },
  origin: string,
  refusal: string,
  notice?: Strk20NoticeReason,
  admission?: ApprovalReservation,
): Promise<RuntimeResponse> => {
  try {
    const held = deps.approvals.requestStrk20Unavailable({
      ...(admission === undefined ? {} : { arrivedAt: admission.arrivedAt }),
      ...(notice === undefined ? {} : { notice }),
      origin,
      refusal,
    });
    admission?.release();
    notifyApprovalsChanged();
    return await deps.waiters.register(held.id);
  } catch (error) {
    return { error: strk20ErrorMessage(error) };
  }
};
