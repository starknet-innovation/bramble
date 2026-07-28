/**
 * Focused NFT send template. Collection browsing and metadata inspection stay
 * behind this screen; recipient choice, decoded review, and confirmation share
 * one deliberate transfer task using the existing verified invoke boundary.
 */
import type { DiscoveredNft, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState, receipt } from "../ui/content";
import { button } from "../ui/controls";
import { textField } from "../ui/fields";
import { menuRow } from "../ui/navigation";
import { icon } from "./icons";
import { nftImageMarkup, selectedNftDetail } from "./nft-views";
import { accountLabel, flowHeader, flowScreen, noAccountEmpty } from "./parts";

/**
 * Renders the recipient-first NFT transfer flow for the selected collectible.
 */
export const nftSendFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  selectedNftId: string | null,
  discoveredNfts: readonly DiscoveredNft[] = [],
): string => {
  const nft = selectedNftDetail(preferences, discoveredNfts, selectedNftId);
  if (!nft) {
    return (
      flowHeader("Send collectible", status) +
      flowScreen(
        "nft-send",
        `<section class="section">${emptyState("This collectible is no longer available.")}</section>`,
      )
    );
  }
  const contacts =
    preferences?.addressBook.filter((entry) => entry.networkId === status.networkId) ?? [];
  return (
    flowHeader("Send collectible", status, nft.title) +
    flowScreen(
      "nft-send",
      `<section class="section nft-send-identity">
        <div class="nft-send-art">
          ${nftImageMarkup(nft, true, true)}
          ${icon("image")}
        </div>
        ${receipt([
          { label: "Collectible", value: nft.title },
          {
            label: "Collection",
            value: nft.collection || accountLabel(nft.contract),
          },
          { label: "Token id", value: nft.tokenId, valueStyle: "code" },
        ])}
      </section>
      <section class="section">
        ${account ? "" : noAccountEmpty(status)}
        <form id="nft-send-form">
          <input name="contract" type="hidden" value="${escapeHtml(nft.contract)}" />
          <input name="tokenId" type="hidden" value="${escapeHtml(nft.tokenId)}" />
          <input name="networkId" type="hidden" value="${escapeHtml(nft.networkId)}" />
          ${textField({
            autocomplete: "off",
            className: "mono",
            disabled: account === null,
            label: "Send to",
            name: "recipient",
            placeholder: "0x…",
            required: true,
            spellcheck: false,
          })}
          ${
            contacts.length === 0
              ? ""
              : `<div class="stack-tight">
                  <p class="eyebrow">Address book</p>
                  <div class="menu-list" role="group" aria-label="Saved recipients">
                    ${contacts
                      .map((contact) =>
                        menuRow({
                          attributes: { "data-nft-recipient": contact.address },
                          icon: "user",
                          label: contact.label,
                          supportingText: accountLabel(contact.address),
                        }),
                      )
                      .join("")}
                  </div>
                </div>`
          }
          <p class="hint">Ownership and token standard are checked again on-chain. Nothing is submitted until the decoded review is confirmed.</p>
          <div id="nft-review-panel" aria-live="polite"></div>
          ${button({
            disabled: account === null,
            icon: "send",
            label: "Review transfer",
            type: "submit",
          })}
          <p id="nft-send-result" role="status" aria-live="polite"></p>
        </form>
      </section>`,
    )
  );
};
