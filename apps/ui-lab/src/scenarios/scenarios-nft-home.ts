/**
 * Checkpoints for NFTs on Home (Derek, 2026-11-06): the Home NFTs tab with
 * NFTs, empty, incomplete and unavailable; Home with NFTs turned off; a site's
 * NFT watch request with NFTs on and off; and the Appearance toggle.
 */
import type { PendingApproval } from "@bramble/wallet-ui/lab";
import { preferences } from "../fixtures/fixtures";
import { walletDashboard } from "../runtime/scenario-dashboard";
import type { WalletScenario } from "../runtime/types";

const NFT_WATCH: PendingApproval = {
  id: "00000000-0000-4000-8000-000000000871",
  kind: "watch-asset",
  nft: {
    contract: "0x0511a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f",
    networkId: "SN_MAIN",
    standard: "ERC721",
    tokenId: "342",
  },
  origin: "https://app.example-nfts.xyz",
};

const nftsOff = { ...preferences, collectiblesPreview: false };

/** The NFTs-on-Home scenario. */
export const nftHomeScenario: WalletScenario = {
  checkpoints: [
    {
      content: () => walletDashboard({ homeTab: "nfts", nftCoverage: "complete" }),
      id: "home-nfts",
      label: "Home NFTs tab",
      narrative:
        "Home reads Tokens · NFTs. The NFTs tab shows Watch by contract, Hidden collectibles, and each owned NFT as a card that opens its detail screen.",
      state: { coverage: "complete", homeTab: "nfts", shown: 1 },
    },
    {
      content: () =>
        walletDashboard({ discoveredNfts: [], homeTab: "nfts", nftCoverage: "complete" }),
      id: "home-nfts-empty",
      label: "Home NFTs empty",
      narrative:
        "A complete answer with nothing owned shows the empty state and the way to watch one.",
      state: { coverage: "complete", homeTab: "nfts", shown: 0 },
    },
    {
      content: () => walletDashboard({ homeTab: "nfts", nftCoverage: "incomplete" }),
      id: "home-nfts-incomplete",
      label: "Home NFTs incomplete",
      narrative:
        "Starkscan's list is partial, so the tab says it may be missing NFTs above what it has.",
      state: { coverage: "incomplete", homeTab: "nfts", shown: 1 },
    },
    {
      content: () =>
        walletDashboard({ discoveredNfts: [], homeTab: "nfts", nftCoverage: "unavailable" }),
      id: "home-nfts-unavailable",
      label: "Home NFTs unavailable",
      narrative:
        "The NFT list could not be loaded: the tab says only watched NFTs are shown, never that there are none.",
      state: { coverage: "unavailable", homeTab: "nfts", shown: 0 },
    },
    {
      content: () => walletDashboard({ preferences: nftsOff }),
      id: "home-nfts-off",
      label: "NFTs turned off",
      narrative: "With Show NFTs on Home off, Home has only Tokens and loads no NFT data.",
      state: { homeTab: "none", nfts: "off" },
    },
    {
      content: () => walletDashboard({ pending: [NFT_WATCH] }),
      id: "watch-nft",
      label: "Site watches an NFT",
      narrative:
        "A site's wallet_watchAsset for an ERC-721 shows the full contract, token ID and network; approving re-checks ownership on chain.",
      state: { kind: "watch-asset", nfts: "on", pending: 1 },
    },
    {
      content: () => walletDashboard({ pending: [NFT_WATCH], preferences: nftsOff }),
      id: "watch-nft-off",
      label: "Site watch, NFTs off",
      narrative:
        "With NFTs turned off the request can only be closed, which the site reads as a decline.",
      state: { kind: "watch-asset", nfts: "off", pending: 1 },
    },
    {
      content: () => walletDashboard({ view: "appearance" }),
      id: "nfts-toggle",
      label: "Show NFTs on Home",
      narrative:
        "The NFTs setting in Appearance & currency, on by default, with the line saying Starkscan sees the address.",
      state: { nfts: "on", view: "appearance" },
    },
  ],
  description:
    "The Home NFTs tab in each state, NFTs turned off, a site's NFT watch request on and off, and the setting.",
  id: "nft-home",
  surface: "sidepanel",
  title: "NFTs on Home",
  views: ["home", "appearance"],
};
