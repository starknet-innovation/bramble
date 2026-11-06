/**
 * The collectibles preview switch and, while it is on, the NFT indexer field
 * on the advanced-endpoints screen. The gallery has been parked since v0.10.1;
 * the preview reopens it for people who opt in, and the indexer stays empty
 * until they choose one: their own, or Starkscan through the SNF gateway.
 */

import { escapeHtml } from "@bramble/core/html";
import { DEFAULT_NFT_INDEXER_URL } from "@bramble/portfolio/nft-indexer";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { checkboxField, textField } from "@bramble/ui-kit/fields";

type Disclosure = (id: string, title: string, state: string, body: string) => string;

// Offered only when the SNF gateway route to Starkscan exists and no indexer
// is configured: one click stores it, after the line saying what it covers
// and who learns the account's address (accepted by the owner, 2026-11-06).
const defaultIndexerOffer = (configured: string, defaultIndexer: string | null): string =>
  defaultIndexer && !configured
    ? `<p class="hint">Finds ERC-721 NFTs on Mainnet. Starkscan and ${escapeHtml(new URL(defaultIndexer).host)} see this account's address. Watch ERC-1155 NFTs by contract.</p>
      ${button({
        attributes: { "data-indexer-default": defaultIndexer },
        icon: "check",
        label: "Use Starkscan",
        variant: "secondary",
      })}`
    : "";

// The disclosure's state names Starkscan when the saved indexer is its route.
const indexerState = (configured: string, defaultIndexer: string | null): string => {
  if (!configured) return "Off";
  return defaultIndexer !== null && configured === defaultIndexer ? "Starkscan" : "Configured";
};

/**
 * Renders the preview switch, then the indexer form when the preview is on.
 */
export const collectiblesSettings = (
  preferences: WalletPreferences | null,
  disclosure: Disclosure,
  defaultIndexer: string | null = DEFAULT_NFT_INDEXER_URL,
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
    <p class="hint">Unfinished. Every NFT shown is checked on-chain against this account.</p>`,
  );
  if (!preview) return toggle;
  return `${toggle}
    ${disclosure(
      "nft-indexer",
      "NFT indexer",
      indexerState(configured, defaultIndexer),
      `<form id="nft-indexer-form">
        ${textField({
          autocomplete: "off",
          className: "mono",
          hint: "Lists the NFTs an account owns, and sees its address. Ownership is re-checked on-chain. Leave empty to show only NFTs you watch.",
          label: "NFT discovery endpoint",
          name: "indexerUrl",
          placeholder: "https://…",
          spellcheck: false,
          type: "url",
          value: configured,
        })}
        ${button({ icon: "check", label: "Save indexer", type: "submit", variant: "secondary" })}
        <p id="nft-indexer-result" role="status"></p>
      </form>
      ${defaultIndexerOffer(configured, defaultIndexer)}`,
    )}`;
};
