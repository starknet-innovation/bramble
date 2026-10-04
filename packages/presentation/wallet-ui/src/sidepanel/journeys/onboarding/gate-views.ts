/**
 * Gate screens shown before the wallet dashboard: onboarding for first-run
 * wallet creation and the unlock screen for locked vaults. Both use a centered
 * brand mark, a large heading, and a primary action pinned to the bottom.
 */

import { BRAMBLE_MARK } from "@bramble/ui-kit/brand-mark";
import { callout } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import { MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { onboardingWizard } from "./onboarding-views";

const gateBrand = (): string => `<div class="gate-brand">${BRAMBLE_MARK}</div>`;

/**
 * First-run screen: a staged fresh-wallet, recovery-phrase, or Ledger journey.
 */
export const onboarding = (status: WalletStatus): string => onboardingWizard(status);

/**
 * Unlock screen for an existing but locked vault.
 */
export const locked = (status: WalletStatus, pending: readonly PendingApproval[] = []): string => {
  const request = pending[0];
  return `
  <main class="screen flow gate">
    ${gateBrand()}
    <div class="gate-head">
      <h1>Welcome back</h1>
    </div>
    ${
      request
        ? callout({
            body: request.origin,
            className: "gate-request",
            icon: "link",
            role: "status",
            title: "Site request waiting",
          })
        : ""
    }
    <form id="unlock-form" class="gate-form">
      ${textField({
        autocomplete: "current-password",
        label: "Vault passphrase",
        labelHidden: true,
        minlength: MIN_VAULT_PASSPHRASE_LENGTH,
        name: "vaultPassphrase",
        placeholder: "Enter your passphrase",
        required: true,
        type: "password",
      })}
      <p id="form-result" role="status"></p>
      <div class="gate-cta">
        ${button({
          disabled: !status.ready,
          label: "Unlock",
          type: "submit",
        })}
      </div>
    </form>
    <details class="gate-more" id="unlock-more">
      <summary class="gate-more-summary">More options</summary>
      <div class="gate-more-panel">
        <p class="gate-more-copy">This clears the wallet and starts first-run setup again. Your funds are not deleted; the recovery phrase is the only way back to them.</p>
        <p id="reset-result" role="status"></p>
        <div class="gate-cta">
          ${button({ label: "Reinitialize", type: "button", variant: "secondary" })}
        </div>
      </div>
    </details>
  </main>`;
};
