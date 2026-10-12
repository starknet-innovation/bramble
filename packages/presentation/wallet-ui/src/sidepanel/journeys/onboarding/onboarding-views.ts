/**
 * Pure templates for the staged first-run wallet journey. The browser-facing
 * binder owns transitions and secret values; this module only emits static,
 * escaped controls and never reads or stores wallet material.
 */

import { BRAMBLE_WORDMARK } from "@bramble/ui-kit/brand-mark";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { inputControl, selectField, textareaField, textField } from "@bramble/ui-kit/fields";
import { DEFAULT_NETWORK } from "@bramble/wallet-model/networks";
import { MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import { RECOVERY_SCAN_LIMITS } from "@bramble/wallet-model/recovery";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { DEFAULT_BACKUP_VERIFY_POSITIONS } from "./backup-verify";

/**
 * The consequence of the network every first-run wallet is created on. The
 * binder pins onboarding to DEFAULT_NETWORK, so the line follows it: on Starknet
 * Mainnet it says the wallet holds real funds; on a testnet default there is no
 * such consequence to state. It replaces the old acknowledgement tickbox with a
 * stated fact on each step that creates, imports or restores accounts.
 */
const MAINNET_CONSEQUENCE = "This wallet is on Starknet Mainnet and holds real funds.";
const networkConsequence = (): string =>
  DEFAULT_NETWORK.id === "SN_MAIN"
    ? `<p class="hint onboarding-network-consequence">${MAINNET_CONSEQUENCE}</p>`
    : "";

const flowBack = (label: string): string =>
  iconButton({
    attributes: { "data-onboarding-back": true },
    className: "onboarding-back",
    icon: "chevronLeft",
    label,
    variant: "ghost",
  });

const stepHead = (
  iconName: "book" | "lock" | "shield" | "wallet",
  title: string,
  lede?: string,
) => `
  <div class="onboarding-step-head">
    <div class="onboarding-step-icon">${icon(iconName)}</div>
    <h1>${title}</h1>
    ${lede ? `<p class="lede">${lede}</p>` : ""}
  </div>`;

const option = (
  id: string,
  iconName: "book" | "link" | "shield",
  title: string,
  description?: string,
): string => `
  <button class="onboarding-option" id="${id}" type="button">
    <span class="onboarding-option-icon">${icon(iconName)}</span>
    <span class="onboarding-option-copy">
      <strong>${title}</strong>
      ${description ? `<span>${description}</span>` : ""}
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
export const recoveryWordInputs = (kind: "generated" | "import"): string =>
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

// Labelled from the default positions so the static markup is coherent on its
// own; `bindOnboarding` relabels each field to the positions actually asked as
// soon as a phrase is generated.
const backupVerifyInputs = (): string =>
  DEFAULT_BACKUP_VERIFY_POSITIONS.map((position, index) =>
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
    label: "Vault passphrase",
    minlength: MIN_VAULT_PASSPHRASE_LENGTH,
    name: passphraseName,
    placeholder: `At least ${MIN_VAULT_PASSPHRASE_LENGTH} characters`,
    required: true,
    trailing: iconButton({
      attributes: { "data-passphrase-reveal": true },
      className: "field-action",
      icon: "eye",
      label: "Show passphrase",
      variant: "ghost",
    }),
    type: "password",
  })}
  ${textField({
    autocomplete: "new-password",
    label: "Confirm passphrase",
    minlength: MIN_VAULT_PASSPHRASE_LENGTH,
    name: confirmationName,
    placeholder: "Enter it again",
    required: true,
    type: "password",
  })}
  <div class="password-requirement" aria-live="polite">
    <span class="password-requirement-bar"><span></span></span>
    <span data-password-result>Enter at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters</span>
  </div>`;
};

const welcomeStep = (ready: boolean): string => `
  <section class="onboarding-step onboarding-welcome" data-onboarding-step="welcome">
    <div class="onboarding-lockup">${BRAMBLE_WORDMARK}</div>
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
  </section>`;

const methodStep = (ledgerAvailable = true): string => `
  <section class="onboarding-step" data-onboarding-step="method" hidden>
    ${flowBack("Back to welcome")}
    ${stepHead("wallet", "Import wallet")}
    <div class="onboarding-options">
      ${option(
        "recovery-method-button",
        "book",
        "Recovery phrase",
        "Import a recovery phrase from a Bramble, Ready or Braavos wallet.",
      )}
      ${ledgerAvailable ? option("ledger-method-button", "shield", "Ledger hardware wallet") : ""}
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
    ${stepHead("book", "Enter your recovery phrase")}
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
      <div class="button-row">
        ${button({
          attributes: { "aria-label": "Show recovery phrase", id: "phrase-toggle" },
          icon: "book",
          label: "Show",
          variant: "secondary",
        })}
        ${button({
          attributes: { "aria-label": "Copy recovery phrase", id: "generated-copy-phrase" },
          disabled: true,
          icon: "copy",
          label: "Copy",
          variant: "ghost",
        })}
      </div>
      <p class="hint" id="generated-copy-note">Anyone with these words controls the wallet and its funds. Bramble cannot recover them for you.</p>
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
    ${stepHead("shield", "Confirm your backup")}
    <div class="onboarding-fields">
      <div class="verify-grid">${backupVerifyInputs()}</div>
      <p id="verify-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      <div class="verify-continue-hit">
        ${button({
          attributes: { id: "verify-continue" },
          disabled: true,
          label: "Continue",
        })}
      </div>
    </div>
  </section>`;

const passwordStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="password" hidden>
    ${flowBack("Back")}
    ${stepHead("lock", "Create your vault passphrase")}
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
    ${stepHead("wallet", "Import from a private key")}
    <div class="onboarding-fields">
      <p class="review-flag" role="note">Anyone with this key controls the account.</p>
      ${selectField({
        label: "Account type",
        name: "importKeyContractType",
        options: [
          { label: "Bramble Account", value: "openzeppelin" },
          { label: "Ready Account", value: "argent" },
        ],
        selected: "openzeppelin",
      })}
      ${textareaField({
        autocomplete: "off",
        hint: "This key is stored encrypted in Bramble's key store.",
        label: "Raw Starknet private key",
        name: "importKeyRaw",
        placeholder: "0x…",
        required: true,
        spellcheck: false,
      })}
      <div id="import-key-salt-field" hidden>
        ${textField({
          autocomplete: "off",
          label: "Ready deployment salt (optional)",
          name: "importKeySalt",
          placeholder: "0x…",
          spellcheck: false,
        })}
      </div>
      ${networkConsequence()}
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

/**
 * The grouped account-scan controls shared by first-run recovery and the
 * in-wallet "Import a recovery phrase" flow, so both surfaces render the same
 * detection and selection semantics for one binder (`bindRecoveryAccountUi`).
 * Each family's count is filled in by that binder, never rendered here.
 */
export const recoveryScanFields = (): string => `
      <div class="section-head">
        <p id="recovery-scan-status" class="hint" role="status">Ready to search.</p>
        ${iconButton({ attributes: { id: "recovery-scan-retry" }, icon: "refresh", label: "Retry account search" })}
      </div>
      <details class="disclosure account-group" data-recovery-group="openzeppelin">
        <summary>Bramble accounts<span class="eyebrow" data-detected></span></summary>
        <div class="disclosure-body">
          <ul class="allowance-list" aria-label="Recovered Bramble accounts"></ul>
        </div>
      </details>
      <details class="disclosure account-group" data-recovery-group="argent">
        <summary>Ready accounts<span class="eyebrow" data-detected></span></summary>
        <div class="disclosure-body">
          <ul class="allowance-list" aria-label="Recovered Ready accounts"></ul>
        </div>
      </details>
      <details class="disclosure account-group" data-recovery-group="braavos">
        <summary>Braavos accounts<span class="eyebrow" data-detected></span></summary>
        <div class="disclosure-body">
          <ul class="allowance-list" aria-label="Recovered Braavos accounts"></ul>
        </div>
      </details>
      <details class="disclosure">
        <summary>Advanced manual index</summary>
        <div class="disclosure-body onboarding-fields">
          ${textField({ inputmode: "numeric", label: "Account index", max: RECOVERY_SCAN_LIMITS.maxIndex, min: 0, name: "recoveryManualIndex", type: "number" })}
          ${button({ attributes: { id: "recovery-manual-search" }, label: "Check this index", variant: "secondary" })}
        </div>
      </details>
      <p id="recovery-accounts-result" role="status"></p>`;

const recoveryAccountsStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="recovery-accounts" hidden>
    ${flowBack("Back to passphrase")}
    ${stepHead("wallet", "Find your accounts")}
    <div class="onboarding-fields">
${recoveryScanFields()}
      ${networkConsequence()}
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
    ${stepHead("wallet", "Review your account")}
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
      ${networkConsequence()}
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

const ledgerStep = (status: WalletStatus, ledgerAvailable = true): string =>
  ledgerAvailable
    ? `
  <section class="onboarding-step" data-onboarding-step="ledger" hidden>
    ${flowBack("Back to wallet methods")}
    ${stepHead("lock", "Choose a password")}
    <form id="ledger-setup-form" class="onboarding-fields">
      ${passwordFields("ledger")}
      ${networkConsequence()}
      <p id="ledger-passphrase-result" role="status"></p>
      <div class="onboarding-step-cta">
        ${button({
          attributes: { "data-ledger-first-run": true, id: "ledger-setup-button" },
          disabled: !status.ready,
          label: "Continue with Ledger",
        })}
      </div>
    </form>
  </section>`
    : "";

/**
 * First-run wizard. It preserves Bramble's real creation and Ledger paths
 * while presenting each decision as one focused, reversible step.
 *
 * `ledgerAvailable` false omits the Ledger method and its passphrase step
 * entirely, so a runtime with no Web Bluetooth, WebUSB or WebHID (Gecko) is
 * never offered a flow it cannot finish. It defaults to true so a caller that
 * does not report capability keeps the offered state.
 */
export const onboardingWizard = (status: WalletStatus, ledgerAvailable = true): string => `
  <!--
  THESIS: First-run security is a short sequence of explicit choices, never one long form.
  OWN-WORLD: Neutral panel over the brand landscape, the wordmark lockup at its centre, one accent for the primary action, semantic green/red only.
  STORY: Choose a wallet path, supply only the required credential, protect it, select the account, finish.
  FIRST VIEWPORT: One centered wallet stage; the Bramble wordmark leads to two full-width actions at the foot.
  FORM: Staged wallet setup based on the supplied reference flow, adapted to Bramble trust boundaries.
  -->
  <section class="screen flow gate onboarding-wizard" aria-label="Wallet setup">
    <form id="create-form" class="onboarding-flow" data-wallet-ready="${status.ready}" novalidate>
      ${welcomeStep(status.ready)}
      ${methodStep(ledgerAvailable)}
      ${recoveryStep()}
      ${generatedStep()}
      ${verifyStep()}
      ${importKeyStep()}
      ${passwordStep()}
      ${recoveryAccountsStep()}
      ${accountStep()}
    </form>
    ${ledgerStep(status, ledgerAvailable)}
  </section>`;
