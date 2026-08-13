/** Exact-call composer for frozen Argent multisig signing intents. */
import { escapeHtml } from "@mc-wallet/core/html";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { emptyState } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { textareaField, textField } from "@mc-wallet/ui-kit/fields";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../../popup/responses/responses";
import { flowHeader, flowScreen } from "../../shared/parts";
import { multisigDisplayName } from "./multisig-model";
import type { MultisigPortfolioData } from "./multisig-portfolio";

/**
 * Renders a bounded exact-call composer; background validation remains authoritative.
 */
export const multisigProposeFlow = (
  status: WalletStatus,
  view: ArgentMultisigView | null,
  _preferences: WalletPreferences | null = null,
  _portfolio?: MultisigPortfolioData,
): string => {
  if (!view) {
    return (
      flowHeader("Prepare signing intent", status) +
      flowScreen("multisig-propose", emptyState("This Argent multisig is no longer watched."))
    );
  }
  if (!view.config) {
    return (
      flowHeader("Prepare signing intent", status, multisigDisplayName(view.record)) +
      flowScreen(
        "multisig-propose",
        emptyState(
          "Current on-chain signer authority is unavailable. Retry before preparing an intent.",
        ),
      )
    );
  }
  return (
    flowHeader("Prepare signing intent", status, multisigDisplayName(view.record)) +
    flowScreen(
      "multisig-propose",
      `<section class="section">
        <p class="review-flag" role="note">This freezes one exact Starknet V3 transaction. Every co-signer must review the calls, nonce, sender, fee ceiling, chain and transaction hash—not the note alone.</p>
        <form id="multisig-propose-form" data-multisig-id="${escapeHtml(view.record.id)}">
          ${textField({ className: "mono", label: "Target contract", name: "contractAddress", placeholder: "0x…", required: true, spellcheck: false })}
          ${textField({ className: "mono", label: "Entrypoint", name: "entrypoint", placeholder: "transfer", required: true, spellcheck: false })}
          ${textareaField({ className: "mono", hint: "Whitespace-separated canonical felts. Leave empty only when the entrypoint takes no calldata.", label: "Calldata", name: "calldata", rows: 4, spellcheck: false })}
          ${button({ label: "Prepare exact transaction", type: "submit" })}
          <p id="multisig-propose-result" role="status" aria-live="assertive"></p>
        </form>
      </section>`,
    )
  );
};
