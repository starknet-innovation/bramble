/**
 * Pure templates for the staged first-run wallet journey. The browser-facing
 * binder owns transitions and secret values; this module only emits static,
 * escaped controls and never reads or stores wallet material.
 */

import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { checkboxField, inputControl, textField } from "@mc-wallet/ui-kit/fields";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { BACKUP_VERIFY_POSITIONS } from "./backup-verify";

const flowBack = (label: string): string =>
  iconButton({
    attributes: { "data-onboarding-back": true },
    className: "onboarding-back",
    icon: "chevronLeft",
    label,
    variant: "ghost",
  });

const stepHead = (iconName: "book" | "lock" | "shield" | "wallet", title: string, lede: string) => `
  <div class="onboarding-step-head">
    <div class="onboarding-step-icon">${icon(iconName)}</div>
    <h1>${title}</h1>
    <p class="lede">${lede}</p>
  </div>`;

const mainnetAcknowledgement = (name: string, id: string, text: string): string =>
  checkboxField({
    containerAttributes: { id },
    name,
    text,
  });

const option = (
  id: string,
  iconName: "book" | "shield",
  title: string,
  description: string,
): string => `
  <button class="onboarding-option" id="${id}" type="button">
    <span class="onboarding-option-icon">${icon(iconName)}</span>
    <span class="onboarding-option-copy">
      <strong>${title}</strong>
      <span>${description}</span>
    </span>
    ${icon("chevronRight")}
  </button>`;

/**
 * Renders both recovery grids. Each cell states its 1-based position as content,
 * not a placeholder, so it survives the cell holding a word; the span is
 * `aria-hidden` because the input's `aria-label` already names the word.
 *
 * The cell must never carry `hidden` — the shell's global
 * `[hidden] { display: none !important }` outranks any cell rule, so it could
 * never be shown again. `:has(> input[hidden])` follows the input instead.
 */
const recoveryWordInputs = (kind: "generated" | "import"): string =>
  Array.from(
    { length: 24 },
    (_, index) =>
      `<label class="recovery-word-cell"><span aria-hidden="true">${index + 1}</span>${inputControl(
        {
          ariaLabel: `Recovery word ${index + 1}`,
          attributes: {
            "data-recovery-kind": kind,
            "data-word-index": `${index}`,
            hidden: index >= 12,
          },
          autocomplete: "off",
          autocapitalize: "off",
          className: "recovery-word",
          inputmode: "text",
          name: `${kind}-word-${index}`,
          readonly: kind === "generated",
          spellcheck: false,
        },
      )}</label>`,
  ).join("");

const backupVerifyInputs = (): string =>
  BACKUP_VERIFY_POSITIONS.map((position, index) =>
    textField({
      autocomplete: "off",
      autocapitalize: "off",
      inputmode: "text",
      label: `Word ${position}`,
      name: `verify-${index}`,
      spellcheck: false,
    }),
  ).join("");

const passwordFields = (prefix: "" | "ledger" = ""): string => {
  const passphraseName = prefix === "ledger" ? "ledgerVaultPassphrase" : "vaultPassphrase";
  const confirmationName =
    prefix === "ledger" ? "ledgerVaultPassphraseConfirm" : "vaultPassphraseConfirm";
  return `
  ${textField({
    autocomplete: "new-password",
    hint: "Use at least 12 characters. This unlocks the encrypted vault on this device.",
    label: "Vault passphrase",
    minlength: 12,
    name: passphraseName,
    placeholder: "At least 12 characters",
    required: true,
    type: "password",
  })}
  ${textField({
    autocomplete: "new-password",
    label: "Confirm passphrase",
    minlength: 12,
    name: confirmationName,
    placeholder: "Enter it again",
    required: true,
    type: "password",
  })}
  <div class="password-requirement" aria-live="polite">
    <span class="password-requirement-bar"><span></span></span>
    <span data-password-result>Enter at least 12 characters</span>
  </div>`;
};

const welcomeStep = (ready: boolean): string => `
  <section class="onboarding-step onboarding-welcome" data-onboarding-step="welcome">
    <div class="onboarding-orbit" aria-hidden="true">
      <div class="orbit-field">
        <span class="orbit-ring orbit-ring-outer"></span>
        <span class="orbit-ring orbit-ring-wide"></span>
        <span class="orbit-ring orbit-ring-middle"></span>
        <span class="orbit-ring orbit-ring-inner"></span>
        <span class="orbit-ring orbit-ring-core"></span>
        <span class="orbit-pulse orbit-pulse-a"></span>
        <span class="orbit-pulse orbit-pulse-b"></span>
        <span class="orbit-pulse orbit-pulse-c"></span>
        <span class="orbit-track orbit-track-outer-a">
          <span class="orbit-node"><span class="orbit-node-surface">${icon("shield")}</span></span>
        </span>
        <span class="orbit-track orbit-track-outer-b">
          <span class="orbit-node"><span class="orbit-node-surface">${icon("send")}</span></span>
        </span>
        <span class="orbit-track orbit-track-wide orbit-track-reverse orbit-track-wide-a">
          <span class="orbit-node"><span class="orbit-node-surface">${icon("activity")}</span></span>
        </span>
        <span class="orbit-track orbit-track-middle orbit-track-middle-a">
          <span class="orbit-node"><span class="orbit-node-surface">${icon("image")}</span></span>
        </span>
        <span class="orbit-track orbit-track-middle orbit-track-middle-b">
          <span class="orbit-node"><span class="orbit-node-surface">${icon("globe")}</span></span>
        </span>
        <span class="orbit-track orbit-track-inner orbit-track-reverse orbit-track-inner-a">
          <span class="orbit-node"><span class="orbit-node-surface">${icon("link")}</span></span>
        </span>
        <span class="orbit-track orbit-track-core orbit-track-core-a">
          <span class="orbit-node"><span class="orbit-node-surface">${icon("coins")}</span></span>
        </span>
        <span class="orbit-core"><strong>MC</strong><span>Wallet</span></span>
      </div>
    </div>
    <div class="onboarding-welcome-actions">
      ${button({
        attributes: { id: "create-new-button" },
        disabled: !ready,
        label: "Create a new wallet",
      })}
      ${button({
        attributes: { id: "add-existing-button" },
        disabled: !ready,
        label: "Add an existing wallet",
        variant: "secondary",
      })}
    </div>
    <p class="onboarding-local-note">${icon("lock")} Encrypted locally on this device</p>
  </section>`;

const methodStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="method" hidden>
    ${flowBack("Back to welcome")}
    ${stepHead("wallet", "Choose how to add your wallet", "Bring an existing Starknet wallet into MC Wallet.")}
    <div class="onboarding-options">
      ${option(
        "recovery-method-button",
        "book",
        "Recovery phrase",
        "Import 12 or 24 recovery words from another wallet.",
      )}
      ${option(
        "ledger-method-button",
        "shield",
        "Ledger hardware wallet",
        "Connect a Ledger and choose accounts without exposing keys.",
      )}
    </div>
  </section>`;

const recoveryStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="recovery" hidden>
    ${flowBack("Back to wallet methods")}
    ${stepHead("book", "Enter your recovery phrase", "Type each word, or paste the complete phrase into the first field. Unknown words are flagged as you go.")}
    <div class="onboarding-fields recovery-fields">
      <div class="recovery-grid" data-recovery-grid="import">${recoveryWordInputs("import")}</div>
      <button class="onboarding-inline-action" id="phrase-length-toggle" type="button">Use a 24-word phrase</button>
      <p id="recovery-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "recovery-continue" },
        disabled: true,
        label: "Continue",
      })}
    </div>
  </section>`;

const generatedStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="generated" hidden>
    ${flowBack("Back to welcome")}
    ${stepHead("book", "Save your recovery phrase", "Write these words down in order and keep them offline.")}
    <div class="onboarding-fields">
      <div
        class="recovery-grid is-masked"
        data-recovery-grid="generated"
        aria-hidden="true"
        inert
      >${recoveryWordInputs("generated")}</div>
      ${button({
        attributes: { id: "phrase-toggle" },
        icon: "book",
        label: "Show recovery phrase",
        variant: "secondary",
      })}
      <p class="hint">Anyone with these words controls the wallet. MC Wallet cannot recover them for you.</p>
      <p id="generate-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "generated-continue" },
        disabled: true,
        label: "I saved my phrase",
      })}
    </div>
  </section>`;

const verifyStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="verify" hidden>
    ${flowBack("Back to recovery phrase")}
    ${stepHead("shield", "Confirm your backup", "Enter the requested words to make sure your offline copy is accurate.")}
    <div class="onboarding-fields">
      <div class="verify-grid">${backupVerifyInputs()}</div>
      <p id="verify-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "verify-continue" },
        disabled: true,
        label: "Continue",
      })}
    </div>
  </section>`;

const passwordStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="password" hidden>
    ${flowBack("Back")}
    ${stepHead("lock", "Create your vault passphrase", "You will use this to unlock MC Wallet on this device.")}
    <div class="onboarding-fields">
      ${passwordFields()}
      <p id="passphrase-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "review-account-button" },
        disabled: true,
        label: "Review account",
      })}
    </div>
  </section>`;

const accountStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="accounts" hidden>
    ${flowBack("Back to passphrase")}
    ${stepHead("wallet", "Choose accounts to add", "Select the Starknet account you want available when setup finishes.")}
    <div class="onboarding-fields">
      <button
        class="onboarding-account"
        id="account-preview"
        type="button"
        aria-pressed="false"
      >
        <span class="onboarding-account-avatar">01</span>
        <span class="onboarding-account-copy">
          <strong>Primary account</strong>
          <span data-preview-address>Deriving account…</span>
        </span>
        <span class="onboarding-account-check">${icon("check")}</span>
      </button>
      ${mainnetAcknowledgement(
        "mainnetAck",
        "mainnet-ack",
        "I understand this wallet can hold real funds on Starknet Mainnet.",
      )}
      <p id="form-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "create-wallet-button" },
        disabled: true,
        label: "Add selected account",
        type: "submit",
      })}
    </div>
  </section>`;

const ledgerStep = (status: WalletStatus): string => `
  <section class="onboarding-step" data-onboarding-step="ledger" hidden>
    ${flowBack("Back to wallet methods")}
    ${stepHead("shield", "Secure this wallet with Ledger", "Set a local vault passphrase, then connect the device and choose accounts.")}
    <form id="ledger-setup-form" class="onboarding-fields">
      ${passwordFields("ledger")}
      <p id="ledger-passphrase-result" role="status"></p>
      ${mainnetAcknowledgement(
        "ledgerMainnetAck",
        "ledger-mainnet-ack",
        "I understand this wallet can hold real funds on Starknet Mainnet.",
      )}
      <div class="onboarding-step-cta">
        ${button({
          attributes: { "data-ledger-first-run": true, id: "ledger-setup-button" },
          disabled: !status.ready,
          label: "Continue with Ledger",
        })}
      </div>
    </form>
  </section>`;

/**
 * First-run wizard. It preserves MC Wallet's real creation and Ledger paths
 * while presenting each decision as one focused, reversible step.
 */
export const onboardingWizard = (status: WalletStatus): string => `
  <!--
  THESIS: First-run security is a short sequence of explicit choices, never one long form.
  OWN-WORLD: Achromatic panel, generous dark field, crisp controls, orbital linework, semantic green/red only.
  STORY: Choose a wallet path, supply only the required credential, protect it, select the account, finish.
  FIRST VIEWPORT: One centered wallet stage; an orbiting MC mark leads to two full-width actions at the foot.
  FORM: Staged wallet setup based on the supplied reference flow, adapted to MC Wallet trust boundaries.
  -->
  <main class="screen flow gate onboarding-wizard" aria-label="Wallet setup">
    <form id="create-form" class="onboarding-flow" data-wallet-ready="${status.ready}" novalidate>
      ${welcomeStep(status.ready)}
      ${methodStep()}
      ${recoveryStep()}
      ${generatedStep()}
      ${verifyStep()}
      ${passwordStep()}
      ${accountStep()}
    </form>
    ${ledgerStep(status)}
  </main>`;
