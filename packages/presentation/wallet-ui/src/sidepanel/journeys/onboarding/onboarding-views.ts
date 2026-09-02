/**
 * Pure templates for the staged first-run wallet journey. The browser-facing
 * binder owns transitions and secret values; this module only emits static,
 * escaped controls and never reads or stores wallet material.
 */

import { button, iconButton } from "@bramble/ui-kit/controls";
import {
  checkboxField,
  inputControl,
  selectField,
  textareaField,
  textField,
} from "@bramble/ui-kit/fields";
import { RECOVERY_SCAN_LIMITS } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../popup/responses/responses";
import { BRAMBLE_MARK } from "../../shared/brand-mark";
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
  iconName: "book" | "link" | "shield",
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
        <span class="orbit-core">${BRAMBLE_MARK}<span>Bramble</span></span>
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
    ${stepHead("wallet", "Choose how to add your wallet", "Bring an existing Starknet wallet into Bramble.")}
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
      ${option(
        "key-method-button",
        "link",
        "Private key",
        "Import a single account from its raw Starknet key.",
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
      <p class="hint">Anyone with these words controls the wallet. Bramble cannot recover them for you.</p>
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
    ${stepHead("lock", "Create your vault passphrase", "You will use this to unlock Bramble on this device.")}
    <div class="onboarding-fields">
      <input name="accountContractType" type="hidden" value="openzeppelin" />
      ${passwordFields()}
      <p id="passphrase-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "password-continue-button" },
        disabled: true,
        label: "Continue",
      })}
    </div>
  </section>`;

const importKeyStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="import-key" hidden>
    ${flowBack("Back to wallet methods")}
    ${stepHead("wallet", "Import from a private key", "Add one existing account from its raw Starknet key. The key is validated and stored only inside the encrypted vault.")}
    <div class="onboarding-fields">
      <p class="review-flag" role="note">Anyone with this key controls the account. Paste it only on a device you trust.</p>
      ${selectField({
        hint: "Choose the contract that already owns this key. A different choice derives a different address.",
        label: "Account contract",
        name: "importKeyContractType",
        options: [
          { label: "Bramble Account — Recommended", value: "openzeppelin" },
          { label: "Ready Account", value: "argent" },
        ],
        selected: "openzeppelin",
      })}
      ${textareaField({
        autocomplete: "off",
        hint: "The key never leaves this device unencrypted.",
        label: "Raw Starknet private key",
        name: "importKeyRaw",
        placeholder: "0x…",
        required: true,
        spellcheck: false,
      })}
      ${textField({
        autocomplete: "off",
        hint: "Ready accounts only. Enter the original DEPLOY_ACCOUNT salt to recover an externally created account; leave blank for Bramble's public-key salt.",
        label: "Ready deployment salt (optional)",
        name: "importKeySalt",
        placeholder: "0x…",
        spellcheck: false,
      })}
      ${mainnetAcknowledgement(
        "importKeyMainnetAck",
        "import-key-mainnet-ack",
        "I understand this wallet can hold real funds on Starknet Mainnet.",
      )}
      <p id="import-key-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "import-key-continue" },
        disabled: true,
        label: "Continue",
      })}
    </div>
  </section>`;

const recoveryAccountsStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="recovery-accounts" hidden>
    ${flowBack("Back to passphrase")}
    ${stepHead("wallet", "Find your accounts", "Bramble checks the first 20 account indices for both Bramble and Ready accounts. Accounts with on-chain activity are selected automatically.")}
    <div class="onboarding-fields">
      <div class="section-head">
        <p id="recovery-scan-status" class="hint" role="status">Ready to search.</p>
        ${iconButton({ attributes: { id: "recovery-scan-retry" }, icon: "refresh", label: "Retry account search" })}
      </div>
      <ul class="allowance-list" id="recovery-account-list" aria-label="Recovered accounts"></ul>
      <details class="disclosure">
        <summary>Advanced manual index</summary>
        <div class="disclosure-body onboarding-fields">
          ${textField({ inputmode: "numeric", label: "Account index", max: RECOVERY_SCAN_LIMITS.maxIndex, min: 0, name: "recoveryManualIndex", type: "number" })}
          ${button({ attributes: { id: "recovery-manual-search" }, label: "Check this index", variant: "secondary" })}
        </div>
      </details>
      ${mainnetAcknowledgement(
        "recoveryMainnetAck",
        "recovery-mainnet-ack",
        "I checked these account types and indices and want to restore the selected accounts on Starknet Mainnet.",
      )}
      <p id="recovery-accounts-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "recover-accounts-button" },
        disabled: true,
        label: "Restore selected accounts",
      })}
    </div>
  </section>`;

const accountStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="accounts" hidden>
    ${flowBack("Back to passphrase")}
    ${stepHead("wallet", "Review your account", "Confirm the derived public address, then add it to this wallet.")}
    <div class="onboarding-fields">
      <button
        class="onboarding-account"
        id="account-preview"
        type="button"
        aria-pressed="false"
      >
        <span class="onboarding-account-avatar">01</span>
        <span class="onboarding-account-copy">
          <strong data-preview-label>Primary Bramble account</strong>
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
    ${stepHead("lock", "Protect the Ledger registry", "Create the local vault passphrase used to unlock account labels and settings on this device.")}
    <form id="ledger-setup-form" class="onboarding-fields">
      <input name="ledgerAccountContractType" type="hidden" value="openzeppelin" />
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
 * First-run wizard. It preserves Bramble's real creation and Ledger paths
 * while presenting each decision as one focused, reversible step.
 */
export const onboardingWizard = (status: WalletStatus): string => `
  <!--
  THESIS: First-run security is a short sequence of explicit choices, never one long form.
  OWN-WORLD: Achromatic panel, generous dark field, crisp controls, orbital linework, semantic green/red only.
  STORY: Choose a wallet path, supply only the required credential, protect it, select the account, finish.
  FIRST VIEWPORT: One centered wallet stage; an orbiting Bramble mark leads to two full-width actions at the foot.
  FORM: Staged wallet setup based on the supplied reference flow, adapted to Bramble trust boundaries.
  -->
  <main class="screen flow gate onboarding-wizard" aria-label="Wallet setup">
    <form id="create-form" class="onboarding-flow" data-wallet-ready="${status.ready}" novalidate>
      ${welcomeStep(status.ready)}
      ${methodStep()}
      ${recoveryStep()}
      ${generatedStep()}
      ${verifyStep()}
      ${importKeyStep()}
      ${passwordStep()}
      ${recoveryAccountsStep()}
      ${accountStep()}
    </form>
    ${ledgerStep(status)}
  </main>`;
