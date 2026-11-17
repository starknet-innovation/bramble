/**
 * The multisig private-balance control. The sentence is the fact the buttons
 * do not say: a viewing key reveals every private action of this multisig.
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { selectField, textField } from "@bramble/ui-kit/fields";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { sendAssets, sendBalanceLabel } from "../send/send-model";
import type { MultisigPortfolioData } from "./multisig-portfolio-data";

/**
 * Renders the private-balance section when this network has a pool configured.
 * Buttons stay hidden until the background reports whether the key is held;
 * until then the section says it is loading, and the binding replaces that
 * line with the actions, or with the reason if the read fails.
 */
export const multisigStrk20KeyPanel = (
  networkId: StarknetNetworkId,
  preferences: WalletPreferences | null,
  portfolio: MultisigPortfolioData,
): string => {
  if (!preferences?.strk20Networks?.[networkId]?.poolAddress) return "";
  const balances = "balances" in portfolio.balances ? portfolio.balances.balances : [];
  const assets = sendAssets(networkId, preferences, balances, portfolio.prices, portfolio.changes);
  return `<section class="review-panel" data-ms-strk20-key-panel aria-label="Private balances">
    <p><strong>Private balances</strong></p>
    <p class="hint">Anyone with the viewing key can see all of this multisig's private activity.</p>
    ${emptyState("Loading…", "status", { "data-ms-strk20-key-loading": true })}
    <div class="action-row">
      ${button({
        attributes: { "data-ms-strk20-key": "create", hidden: true },
        label: "Create key",
        size: "small",
        variant: "secondary",
      })}
      ${button({
        attributes: { "data-ms-strk20-key": "share", hidden: true },
        label: "Share key",
        size: "small",
        variant: "secondary",
      })}
      ${button({
        attributes: { "data-ms-strk20-key": "drop", hidden: true },
        label: "Drop key",
        size: "small",
        tone: "danger",
        variant: "secondary",
      })}
    </div>
    <div class="action-row">
      ${button({
        attributes: { "data-ms-strk20-action": "register", hidden: true },
        label: "Register",
        size: "small",
        variant: "secondary",
      })}
      ${button({
        attributes: { "data-ms-strk20-action": "deposit", hidden: true },
        label: "Deposit",
        size: "small",
        variant: "secondary",
      })}
      ${button({
        attributes: { "data-ms-strk20-action": "transfer", hidden: true },
        label: "Transfer",
        size: "small",
        variant: "secondary",
      })}
      ${button({
        attributes: { "data-ms-strk20-action": "withdraw", hidden: true },
        label: "Withdraw",
        size: "small",
        variant: "secondary",
      })}
      ${button({
        attributes: { "data-ms-strk20-action": "share", hidden: true },
        label: "Share",
        size: "small",
        variant: "secondary",
      })}
      ${button({
        attributes: { "data-ms-strk20-action": "refresh", hidden: true },
        label: "Refresh",
        size: "small",
        variant: "secondary",
      })}
      ${button({
        attributes: { "data-ms-strk20-action": "send", hidden: true },
        label: "Send",
        size: "small",
      })}
    </div>
    <div data-ms-strk20-authorizations></div>
    <form data-ms-strk20-form hidden>
      ${selectField({
        label: "Token",
        name: "tokenId",
        options: assets.map((asset) => ({
          attributes: { "data-public-balance": asset.formatted, "data-symbol": asset.symbol },
          label: asset.formatted
            ? `${asset.symbol} · ${sendBalanceLabel(asset.formatted)}`
            : asset.symbol,
          value: asset.id,
        })),
        ...(assets[0] ? { selected: assets[0].id } : {}),
      })}
      ${textField({ autocomplete: "off", inputmode: "decimal", label: "Amount", name: "amount" })}
      ${textField({ autocomplete: "off", label: "To", name: "recipient" })}
      ${button({ label: "Continue", type: "submit", variant: "secondary" })}
    </form>
    <p id="multisig-strk20-key-status" role="status"></p>
  </section>`;
};
