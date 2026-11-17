/**
 * The Home NFTs tab's panel: the gallery content inline (Watch by contract,
 * Hidden collectibles, owned NFTs as cards that open the detail screen, and
 * the incomplete, unavailable and empty states). It reads nothing itself: the
 * NFTs come from the gallery lanes, each re-proved on chain in the background.
 */
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { DiscoveredNft, NftCoverage, WalletStatus } from "../../../popup/responses/responses";
import { nftGalleryBody } from "./nft-views";

/** Renders the NFTs tab panel body for the active account. */
export const homeNftsPanel = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  discovered: readonly DiscoveredNft[],
  coverage: NftCoverage,
): string =>
  `<div class="home-nfts">${nftGalleryBody(status, account, preferences, discovered, coverage).html}</div>`;
