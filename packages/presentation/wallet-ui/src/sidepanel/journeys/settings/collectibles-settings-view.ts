/**
 * The NFT indexer field on the advanced-endpoints screen, shown while NFTs are
 * turned on ("Show NFTs on Home" in Appearance & currency). Left empty,
 * Starkscan lists the account's Mainnet ERC-721 NFTs.
 */

import { nftsShown, type WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import { t } from "../../../i18n/messages";

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
    t("settings.endpoints.nftIndexer"),
    configured ? t("settings.endpoints.configured") : "Starkscan",
    `<form id="nft-indexer-form">
        ${textField({
          autocomplete: "off",
          className: "mono",
          hint: t("settings.endpoints.nftIndexerHint"),
          label: t("settings.endpoints.nftIndexerField"),
          name: "indexerUrl",
          placeholder: "https://…",
          spellcheck: false,
          type: "url",
          value: configured,
        })}
        ${button({ icon: "check", label: t("settings.endpoints.saveIndexer"), type: "submit", variant: "secondary" })}
        <p id="nft-indexer-result" role="status"></p>
      </form>`,
  );
};
