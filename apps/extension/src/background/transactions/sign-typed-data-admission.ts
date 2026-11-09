/**
 * Admission for a dapp `wallet.signTypedData` request, split from ./chain-ops
 * for the size budget.
 */

import { DEFAULT_ORIGIN_GUARD, type OriginGuard } from "@bramble/permissions/blocklist";
import {
  type ApprovalAdmissionProbe,
  requireApprovalAdmission,
} from "../approvals/approval-limits";
import { readSignTypedDataInput } from "../routing/message-inputs";
import {
  type ExtensionIdentity,
  isClaimedSenderOrigin,
  type RuntimeSender,
} from "../routing/senders";
import type { RuntimeResponse } from "../runtime/runtime-types";

/**
 * The perimeter a dapp typed-data request passes before any session or vault
 * read: a well-formed message, a truthfully claimed and unblocked origin, and
 * room in that origin's share of the approval queue. Returns the validated
 * input, or the refusal to answer with; it never throws except for the queue's
 * own admission refusal.
 */
export const admitSignTypedData = (
  deps: {
    readonly approvals: ApprovalAdmissionProbe;
    readonly extension: ExtensionIdentity;
    readonly guard?: OriginGuard;
  },
  message: unknown,
  sender: RuntimeSender | undefined,
):
  | { readonly input: NonNullable<ReturnType<typeof readSignTypedDataInput>> }
  | { readonly refusal: RuntimeResponse } => {
  const input = readSignTypedDataInput(message);
  if (!input) {
    return { refusal: { error: "invalid sign typed data request" } };
  }
  if (!isClaimedSenderOrigin(sender, deps.extension, input.origin)) {
    return { refusal: { error: "sender origin mismatch" } };
  }
  // A blocklisted origin gets no signing prompt even if it still holds an old
  // connection grant — the phishing feed is the defense for the post-grant
  // case. Mirror the sibling dapp surfaces (provider-ops, declare, strk20).
  if ((deps.guard ?? DEFAULT_ORIGIN_GUARD).isBlocked(input.origin)) {
    return { refusal: { error: "origin blocked" } };
  }
  // Refuse a flooding origin BEFORE the expensive work, not after it. Hashing a
  // maximum-size SNIP-12 document can monopolize synchronous Pedersen work in
  // the service worker that also serves the panel, and reading the grants decrypts
  // the vault — paying both for a request the queue cap will refuse anyway is
  // how a per-origin cap that bounds memory leaves CPU unbounded.
  requireApprovalAdmission(deps.approvals, input.origin);
  return { input };
};
