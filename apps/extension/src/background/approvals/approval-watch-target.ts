/**
 * What a watch-asset card is about, a token or a collectible, and when two
 * requests ask for the same thing. Split from approvals.ts to keep the queue
 * within the size budget.
 */
import type { ApprovalQueue } from "./approval-queue-types";
import type { PendingApproval } from "./approval-snapshot";

type WatchRequest = Parameters<ApprovalQueue["requestWatchAsset"]>[0];

/**
 * Whether a queued card already asks for this request's token or collectible
 * on the same network. Cards for a token never match a collectible request.
 */
export const sameWatchTarget = (approval: PendingApproval, request: WatchRequest): boolean =>
  "nft" in request
    ? approval.nft?.contract === request.nft.contract &&
      approval.nft.tokenId === request.nft.tokenId &&
      approval.nft.networkId === request.nft.networkId
    : approval.token?.address === request.token.address &&
      approval.token?.networkId === request.token.networkId;

/**
 * The card's own copy of what it asks to watch, with a token's already-tracked
 * notice mark (audit M1).
 */
export const watchTarget = (
  request: WatchRequest,
): Pick<PendingApproval, "alreadyTracked" | "nft" | "token"> =>
  "nft" in request
    ? { nft: { ...request.nft } }
    : {
        ...(request.alreadyTracked === true ? { alreadyTracked: true } : {}),
        token: { ...request.token },
      };
