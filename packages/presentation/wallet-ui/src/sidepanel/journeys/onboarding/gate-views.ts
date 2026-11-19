/**
 * Gate screens shown before the wallet dashboard: onboarding for first-run
 * wallet creation and the unlock screen for locked vaults. Both use a centered
 * brand mark, a large heading, and a primary action pinned to the bottom.
 */

import { BRAMBLE_MARK } from "@bramble/ui-kit/brand-mark";
import { callout } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { textField } from "@bramble/ui-kit/fields";
import { icon } from "@bramble/ui-kit/icons";
import { MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { recoveryGate } from "./gate-recovery-view";
import { onboardingWizard } from "./onboarding-views";

const gateBrand = (): string => `<div class="gate-brand">${BRAMBLE_MARK}</div>`;

/**
 * Guidance for a forgotten password (issue 903). Text only: Bramble never
 * stores the password, so there is nothing to reset here, and nothing on this
 * screen removes or replaces the wallet (issues 456 and 715). The way back is a
 * reinstall and restore, and the list says what a phrase leaves behind.
 */
const forgotPassword = (): string => `
  <details class="disclosure gate-forgot" data-disclosure="unlock-forgot-password">
    <summary>
      <span class="menu-copy"><strong>Forgot password?</strong></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">
      <p>Bramble can't recover or reset it. It's never stored.</p>
      <p>To get back in, remove Bramble from this browser, reinstall it and restore from your recovery phrase with a new password. Your funds stay on Starknet.</p>
      <p>Your recovery phrase doesn't restore:</p>
      <ul>
        <li>Accounts from imported keys or other recovery phrases</li>
        <li>Ledger accounts (add them again with your device)</li>
        <li>Contacts, site connections and settings</li>
        <li>Activity history</li>
      </ul>
      <p><strong>Without your recovery phrase, removing Bramble loses access to its funds for good.</strong></p>
    </div>
  </details>`;

/**
 * First-run screen: a staged fresh-wallet, recovery-phrase, or Ledger journey.
 * `ledgerAvailable` false omits the Ledger path when the runtime cannot reach a
 * device; it defaults to true so a caller that does not report capability keeps
 * the offered state.
 */
export const onboarding = (status: WalletStatus, ledgerAvailable = true): string =>
  onboardingWizard(status, ledgerAvailable);

/**
 * Unlock screen for an existing but locked vault, or the recovery gate when
 * the background reports the vault cannot be verified.
 */
export const locked = (status: WalletStatus, pending: readonly PendingApproval[] = []): string => {
  if (status.recovery) {
    return recoveryGate(
      status,
      status.recovery,
      gateBrand(),
      textField({
        autocomplete: "current-password",
        label: "Password",
        labelHidden: true,
        minlength: MIN_VAULT_PASSPHRASE_LENGTH,
        name: "vaultPassphrase",
        placeholder: "Enter your password",
        required: true,
        type: "password",
      }),
    );
  }
  const request = pending[0];
  return `
  <section class="screen flow gate">
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
        label: "Password",
        labelHidden: true,
        minlength: MIN_VAULT_PASSPHRASE_LENGTH,
        name: "vaultPassphrase",
        placeholder: "Enter your password",
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
        ${forgotPassword()}
      </div>
    </form>
  </section>`;
};
