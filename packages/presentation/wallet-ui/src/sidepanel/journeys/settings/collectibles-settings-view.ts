/**
 * The collectibles preview switch and, while it is on, the NFT indexer field
 * on the advanced-endpoints screen. The gallery has been parked since v0.10.1;
 * the preview reopens it for people who opt in, and the indexer stays empty
 * until they choose one.
 */

import { escapeHtml } from "@bramble/core/html";
import { DEFAULT_NFT_INDEXER_URL } from "@bramble/portfolio/nft-indexer";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { checkboxField, textField } from "@bramble/ui-kit/fields";

type Disclosure = (id: string, title: string, state: string, body: string) => string;

// Offered only when a Bramble-run indexer exists and none is configured: one
// click stores it as the indexer, after the line saying what it learns.
const defaultIndexerOffer = (configured: string, defaultIndexer: string | null): string =>
  defaultIndexer && !configured
    ? `<p class="hint">The Bramble indexer at ${escapeHtml(new URL(defaultIndexer).host)} sees this account's address when it lists its NFTs.</p>
      ${button({
        attributes: { "data-indexer-default": defaultIndexer },
        icon: "check",
        label: "Use the Bramble indexer",
        variant: "secondary",
      })}`
    : "";

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
      configured ? "Configured" : "Off",
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
