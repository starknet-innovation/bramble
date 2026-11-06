/**
 * The collectibles preview switch and, while it is on, the NFT indexer field
 * on the advanced-endpoints screen. The gallery has been parked since v0.10.1;
 * the preview reopens it for people who opt in, and the indexer stays empty
 * unless they choose their own: left empty, Starkscan lists Mainnet ERC-721s.
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { checkboxField, textField } from "@bramble/ui-kit/fields";

type Disclosure = (id: string, title: string, state: string, body: string) => string;

/**
 * Renders the preview switch, then the indexer form when the preview is on.
 */
export const collectiblesSettings = (
  preferences: WalletPreferences | null,
  disclosure: Disclosure,
): string => {
  const preview = preferences?.collectiblesPreview ?? false;
  const configured = preferences?.nftIndexerUrl ?? "";
  const toggle = disclosure(
    "collectibles-preview",
    "Collectibles preview",
    preview ? "On" : "Off",
    `${checkboxField({
      attributes: { id: "collectibles-preview" },
      checked: preview,
      name: "collectiblesPreview",
      text: "Show Collectibles in the portfolio menu",
    })}
    <p class="hint">Unfinished. On Mainnet, Starkscan finds this account's ERC-721 NFTs and sees its address. Every NFT shown is checked on-chain.</p>`,
  );
  if (!preview) return toggle;
  return `${toggle}
    ${disclosure(
      "nft-indexer",
      "NFT indexer",
      configured ? "Configured" : "Starkscan",
      `<form id="nft-indexer-form">
        ${textField({
          autocomplete: "off",
          className: "mono",
          hint: "Lists the NFTs an account owns, and sees its address. Ownership is re-checked on-chain. Leave empty to use Starkscan, which finds ERC-721 NFTs on Mainnet only. Watch ERC-1155 NFTs by contract.",
          label: "NFT discovery endpoint",
          name: "indexerUrl",
          placeholder: "https://…",
          spellcheck: false,
          type: "url",
          value: configured,
        })}
        ${button({ icon: "check", label: "Save indexer", type: "submit", variant: "secondary" })}
        <p id="nft-indexer-result" role="status"></p>
      </form>`,
    )}`;
};
