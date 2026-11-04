/**
 * Queues a site's request to watch a collectible (wallet_watchAsset with an
 * ERC721 or ERC1155 asset, ahead of the Starknet wallet API). Nothing about
 * the token is read here: ownership is proven on chain only when the user
 * approves the card, so the site learns nothing before the user acts.
 */
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { canonicalAddress } from "@bramble/wallet-model/networks";
import type { ProviderWatchNft } from "@bramble/wallet-protocol/watch-asset";
import { requireApprovalAdmission } from "../approvals/approval-limits";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import type { ApprovalQueue, PendingApproval } from "../approvals/approvals";

/**
 * Queues one collectible watch card for the active network, or returns null
 * when the collectibles preview is off: the gallery is parked, so the request
 * is answered as an unusable asset, the same answer a malformed one gets.
 */
export const trackWatchNft = async (
  deps: {
    readonly approvals: ApprovalQueue;
    readonly preferencesStore: WalletPreferencesStore;
  },
  input: { readonly nft: ProviderWatchNft; readonly origin: string },
): Promise<PendingApproval | null> => {
  const contract = canonicalAddress(input.nft.address);
  if (!contract) return null;
  const preferences = await deps.preferencesStore.read();
  if (!preferences.collectiblesPreview) return null;
  const nft = {
    contract,
    networkId: preferences.activeNetworkId,
    standard: input.nft.standard,
    tokenId: input.nft.tokenId,
  };
  const queued = deps.approvals
    .list()
    .find(
      (approval) =>
        approval.kind === "watch-asset" &&
        approval.origin === input.origin &&
        approval.nft?.contract === nft.contract &&
        approval.nft.tokenId === nft.tokenId &&
        approval.nft.networkId === nft.networkId,
    );
  if (queued) return queued;
  requireApprovalAdmission(deps.approvals, input.origin);
  const pending = deps.approvals.requestWatchAsset({ nft, origin: input.origin });
  notifyApprovalsChanged();
  return pending;
};
