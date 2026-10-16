/**
 * The approve applier for a watch-asset card, and the answer a site gets once
 * its token is tracked. Split from approval-decisions.ts to keep that file
 * within the size budget. Reached only from an extension page's decision on a
 * claimed approval; the dapp never calls it.
 */

import { WalletError } from "@bramble/core/errors";
import { isLikelySpam } from "@bramble/portfolio/token-registry";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import { sameFelt } from "@bramble/wallet-model/networks";
import { withTokenId } from "@bramble/wallet-model/preferences";
import { type ApplyResult, reject } from "./approval-applier";
import type { PendingApproval } from "./approvals";

/**
 * What a site gets once its token is tracked: after the user approves the
 * card, or closes the already-tracked notice (audit M1). Never sent earlier.
 */
export const WATCH_ASSET_TRACKED_RESPONSE = { ok: true, watched: true } as const;

const tracked: ApplyResult = {
  respond: (listPending) => ({ ok: true, pending: listPending() }),
  settle: WATCH_ASSET_TRACKED_RESPONSE,
  status: "settle",
};

/**
 * Applies an approved watch-asset card. An address already tracked on the
 * network, under any id, is answered as watched without writing: a second
 * origin's card for the same token, or an older card approved after the user
 * added the token by hand, whose record and trusted status are kept (#682).
 * The store refuses past its added-token cap; that refusal reaches the dapp
 * and the panel as is. An already-tracked notice writes nothing and answers as
 * its Close does.
 */
export const applyWatchAssetApproval = async (
  preferencesStore: WalletPreferencesStore,
  approval: PendingApproval,
): Promise<ApplyResult> => {
  if (!approval.token) {
    return reject({ error: "approval not found" });
  }
  if (approval.alreadyTracked === true) {
    return tracked;
  }
  // Tracked since the card was queued: keep that record and write nothing, so
  // neither the upsert nor the spam hide below can touch it. The store applies
  // the same rule inside its own write, which covers a race with this read.
  const card = approval.token;
  const current = await preferencesStore.read();
  if (
    current.tokens.some(
      (token) => token.networkId === card.networkId && sameFelt(token.address, card.address),
    )
  ) {
    return tracked;
  }
  // Recorded as dapp-supplied (audit 171): its metadata came from the site, so
  // the call reviewer does not trust it unless it matches a curated token.
  let stored: Awaited<ReturnType<WalletPreferencesStore["upsertToken"]>>;
  try {
    stored = await preferencesStore.upsertToken(approval.token, "dapp");
  } catch (error) {
    if (error instanceof WalletError) {
      return reject({ error: error.message });
    }
    throw error;
  }
  // Same rule as wallet.addToken: a dapp-suggested token that borrows a known
  // ticker or carries malformed metadata is stored hidden. Only when the card
  // wrote its own record: an address already tracked under another id is left
  // as it is, and a hide flag for the card's id would point at nothing.
  const tokenId = withTokenId(approval.token).id;
  if (isLikelySpam(approval.token) && stored.tokens.some((token) => token.id === tokenId)) {
    await preferencesStore.setTokenHidden({ hidden: true, tokenId });
  }
  return tracked;
};
