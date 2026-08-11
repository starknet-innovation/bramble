/**
 * Gate screens shown before the wallet dashboard: onboarding for first-run
 * wallet creation and the unlock screen for locked vaults. Both use a centered
 * brand mark, a large heading, and a primary action pinned to the bottom.
 */

import { callout } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { textField } from "@mc-wallet/ui-kit/fields";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { onboardingWizard } from "./onboarding-views";

const gateBrand = (): string => `<div class="gate-brand">${icon("wallet")}</div>`;

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
      <p class="lede">${request ? "Unlock to review the wallet request waiting for you." : "Unlock your wallet to continue."}</p>
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
        minlength: 12,
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
  </main>`;
};
