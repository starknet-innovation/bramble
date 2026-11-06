/**
 * The NFT indexer field on the advanced-endpoints screen, shown while NFTs are
 * turned on ("Show NFTs on Home" in Appearance & currency). Left empty,
 * Starkscan lists the account's Mainnet ERC-721 NFTs.
 */

import { nftsShown, type WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";

type Disclosure = (id: string, title: string, state: string, body: string) => string;

/**
 * Renders the indexer form while NFTs are on, and nothing while they are off.
 */
export const collectiblesSettings = (
  preferences: WalletPreferences | null,
  disclosure: Disclosure,
): string => {
  if (!nftsShown(preferences)) return "";
  const configured = preferences?.nftIndexerUrl ?? "";
  return disclosure(
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
  );
};
