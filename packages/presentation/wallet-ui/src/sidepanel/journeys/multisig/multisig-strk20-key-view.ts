/**
 * The multisig private-balance control. The sentence is the fact the buttons
 * do not say: a viewing key reveals every private action of this multisig.
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";

/**
 * Renders the private-balance section when this network has a pool configured.
 * Buttons stay hidden until the background reports whether the key is held.
 */
export const multisigStrk20KeyPanel = (
  networkId: StarknetNetworkId,
  preferences: WalletPreferences | null,
): string => {
  if (!preferences?.strk20Networks?.[networkId]?.poolAddress) return "";
  return `<section class="review-panel" data-ms-strk20-key-panel aria-label="Private balances">
    <p><strong>Private balances</strong></p>
    <p class="hint">Anyone with the viewing key can see all of this multisig's private activity.</p>
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
    <form data-ms-strk20-form hidden>
      ${textField({ autocomplete: "off", inputmode: "decimal", label: "Amount", name: "amount" })}
      ${textField({ autocomplete: "off", label: "To", name: "recipient" })}
      ${button({ label: "Continue", type: "submit", variant: "secondary" })}
    </form>
    <p id="multisig-strk20-key-status" role="status"></p>
  </section>`;
};
