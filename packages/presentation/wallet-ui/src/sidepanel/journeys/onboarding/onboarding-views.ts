/**
 * Pure templates for the staged first-run wallet journey. The browser-facing
 * binder owns transitions and secret values; this module only emits static,
 * escaped controls and never reads or stores wallet material.
 */

import { escapeHtml } from "@bramble/core/html";
import { BRAMBLE_WORDMARK } from "@bramble/ui-kit/brand-mark";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { inputControl, selectField, textareaField, textField } from "@bramble/ui-kit/fields";
import { DEFAULT_NETWORK } from "@bramble/wallet-model/networks";
import { MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import { RECOVERY_SCAN_LIMITS } from "@bramble/wallet-model/recovery";
import { t, th } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { addressFinderFields } from "./address-finder-view";
import { DEFAULT_BACKUP_VERIFY_POSITIONS } from "./backup-verify";

/**
 * The consequence of the network every first-run wallet is created on. The
 * binder pins onboarding to DEFAULT_NETWORK, so the line follows it: on Starknet
 * Mainnet it says the wallet holds real funds; on a testnet default there is no
 * such consequence to state. It replaces the old acknowledgement tickbox with a
 * stated fact on each step that creates, imports or restores accounts.
 */
const networkConsequence = (): string =>
  DEFAULT_NETWORK.id === "SN_MAIN"
    ? `<p class="hint onboarding-network-consequence">${th("onboarding.mainnet")}</p>`
    : "";

const scanGroup = (family: string): string => th("onboarding.scan.group", { family });
const scanGroupList = (family: string): string => th("onboarding.scan.groupList", { family });

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
    <h1>${escapeHtml(title)}</h1>
    ${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ""}
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
      <strong>${escapeHtml(title)}</strong>
      ${description ? `<span>${escapeHtml(description)}</span>` : ""}
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
          ariaLabel: t("onboarding.phrase.word", { position: String(index + 1) }),
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
      label: t("onboarding.verify.word", { position: String(position) }),
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
    label: t("onboarding.passphrase.field"),
    minlength: MIN_VAULT_PASSPHRASE_LENGTH,
    name: passphraseName,
    placeholder: t("onboarding.passphrase.minimum", { min: String(MIN_VAULT_PASSPHRASE_LENGTH) }),
    required: true,
    trailing: iconButton({
      attributes: { "data-passphrase-reveal": true },
      className: "field-action",
      icon: "eye",
      label: t("onboarding.passphrase.show"),
      variant: "ghost",
    }),
    type: "password",
  })}
  ${textField({
    autocomplete: "new-password",
    label: t("onboarding.passphrase.confirm"),
    minlength: MIN_VAULT_PASSPHRASE_LENGTH,
    name: confirmationName,
    placeholder: t("onboarding.passphrase.again"),
    required: true,
    type: "password",
  })}
  <div class="password-requirement" aria-live="polite">
    <span class="password-requirement-bar"><span></span></span>
    <span data-password-result>${th("onboarding.passphrase.tooShort", { min: String(MIN_VAULT_PASSPHRASE_LENGTH) })}</span>
  </div>`;
};

const welcomeStep = (ready: boolean): string => `
  <section class="onboarding-step onboarding-welcome" data-onboarding-step="welcome">
    <div class="onboarding-lockup">${BRAMBLE_WORDMARK}</div>
    <div class="onboarding-welcome-actions">
      ${button({
        attributes: { id: "create-new-button" },
        disabled: !ready,
        label: t("onboarding.welcome.create"),
      })}
      ${button({
        attributes: { id: "add-existing-button" },
        disabled: !ready,
        label: t("onboarding.welcome.addExisting"),
        variant: "secondary",
      })}
    </div>
  </section>`;

const methodStep = (ledgerAvailable = true): string => `
  <section class="onboarding-step" data-onboarding-step="method" hidden>
    ${flowBack(t("onboarding.back.welcome"))}
    ${stepHead("wallet", t("onboarding.method.title"))}
    <div class="onboarding-options">
      ${option(
        "recovery-method-button",
        "book",
        t("onboarding.method.phrase"),
        t("onboarding.method.phraseHint"),
      )}
      ${ledgerAvailable ? option("ledger-method-button", "shield", t("onboarding.method.ledger")) : ""}
      ${option(
        "key-method-button",
        "link",
        t("onboarding.method.key"),
        t("onboarding.method.keyHint"),
      )}
    </div>
  </section>`;

const recoveryStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="recovery" hidden>
    ${flowBack(t("onboarding.back.methods"))}
    ${stepHead("book", t("onboarding.phrase.title"))}
    <div class="onboarding-fields recovery-fields">
      <div class="recovery-grid" data-recovery-grid="import">${recoveryWordInputs("import")}</div>
      <div class="recovery-actions">
        <button class="onboarding-inline-action" id="phrase-length-toggle" type="button">${th("onboarding.phrase.use24")}</button>
        <button class="onboarding-inline-action" id="phrase-clear" type="button">${th("onboarding.phrase.clear")}</button>
      </div>
      <p id="recovery-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "recovery-continue" },
        disabled: true,
        label: t("onboarding.continue"),
      })}
    </div>
  </section>`;

const generatedStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="generated" hidden>
    ${flowBack(t("onboarding.back.welcome"))}
    ${stepHead("book", t("onboarding.generated.title"), t("onboarding.generated.lede"))}
    <div class="onboarding-fields">
      <div
        class="recovery-grid is-masked"
        data-recovery-grid="generated"
        aria-hidden="true"
        inert
      >${recoveryWordInputs("generated")}</div>
      <div class="button-row">
        ${button({
          attributes: { "aria-label": t("onboarding.generated.showLabel"), id: "phrase-toggle" },
          icon: "book",
          label: t("onboarding.generated.show"),
          variant: "secondary",
        })}
        ${button({
          attributes: {
            "aria-label": t("onboarding.generated.copyLabel"),
            id: "generated-copy-phrase",
          },
          disabled: true,
          icon: "copy",
          label: t("onboarding.generated.copy"),
          variant: "ghost",
        })}
      </div>
      <p class="hint" id="generated-copy-note">${th("onboarding.generated.note")}</p>
      <p id="generate-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "generated-continue" },
        disabled: true,
        label: t("onboarding.generated.continue"),
      })}
    </div>
  </section>`;

const verifyStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="verify" hidden>
    ${flowBack(t("onboarding.back.phrase"))}
    ${stepHead("shield", t("onboarding.verify.title"))}
    <div class="onboarding-fields">
      <div class="verify-grid">${backupVerifyInputs()}</div>
      <p id="verify-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      <div class="verify-continue-hit">
        ${button({
          attributes: { id: "verify-continue" },
          disabled: true,
          label: t("onboarding.continue"),
        })}
      </div>
    </div>
  </section>`;

const passwordStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="password" hidden>
    ${flowBack(t("onboarding.back"))}
    ${stepHead("lock", t("onboarding.passphrase.title"))}
    <div class="onboarding-fields">
      <input name="accountContractType" type="hidden" value="openzeppelin" />
      ${passwordFields()}
      <p id="passphrase-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "password-continue-button" },
        disabled: true,
        label: t("onboarding.continue"),
      })}
    </div>
  </section>`;

const importKeyStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="import-key" hidden>
    ${flowBack(t("onboarding.back.methods"))}
    ${stepHead("wallet", t("onboarding.key.title"))}
    <div class="onboarding-fields">
      <p class="review-flag" role="note">${th("onboarding.key.flag")}</p>
      ${selectField({
        label: t("onboarding.key.accountType"),
        name: "importKeyContractType",
        options: [
          { label: t("onboarding.key.brambleAccount"), value: "openzeppelin" },
          { label: t("onboarding.key.readyAccount"), value: "argent" },
        ],
        selected: "openzeppelin",
      })}
      ${textareaField({
        autocomplete: "off",
        hint: t("onboarding.key.hint"),
        label: t("onboarding.key.field"),
        name: "importKeyRaw",
        placeholder: "0x…",
        required: true,
        spellcheck: false,
      })}
      <div id="import-key-salt-field" hidden>
        ${textField({
          autocomplete: "off",
          label: t("onboarding.key.salt"),
          name: "importKeySalt",
          placeholder: "0x…",
          spellcheck: false,
        })}
      </div>
      ${networkConsequence()}
      <p id="import-key-result" role="status"></p>
      ${addressFinderFields("key", { hidden: true })}
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "import-key-continue" },
        disabled: true,
        label: t("onboarding.continue"),
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
        <p id="recovery-scan-status" class="hint" role="status">${th("onboarding.scan.ready")}</p>
        ${iconButton({ attributes: { id: "recovery-scan-retry" }, icon: "refresh", label: t("onboarding.scan.retry") })}
      </div>
      <details class="disclosure account-group" data-recovery-group="openzeppelin">
        <summary>${scanGroup("Bramble")}<span class="eyebrow" data-detected></span></summary>
        <div class="disclosure-body">
          <ul class="allowance-list" aria-label="${scanGroupList("Bramble")}"></ul>
        </div>
      </details>
      <details class="disclosure account-group" data-recovery-group="argent">
        <summary>${scanGroup("Ready")}<span class="eyebrow" data-detected></span></summary>
        <div class="disclosure-body">
          <ul class="allowance-list" aria-label="${scanGroupList("Ready")}"></ul>
        </div>
      </details>
      <details class="disclosure account-group" data-recovery-group="braavos">
        <summary>${scanGroup("Braavos")}<span class="eyebrow" data-detected></span></summary>
        <div class="disclosure-body">
          <ul class="allowance-list" aria-label="${scanGroupList("Braavos")}"></ul>
        </div>
      </details>${addressFinderFields("recovery")}
      <details class="disclosure">
        <summary>${th("onboarding.scan.manual")}</summary>
        <div class="disclosure-body onboarding-fields">
          ${textField({ inputmode: "numeric", label: t("onboarding.scan.accountIndex"), max: RECOVERY_SCAN_LIMITS.maxIndex, min: 0, name: "recoveryManualIndex", type: "number" })}
          ${button({ attributes: { id: "recovery-manual-search" }, label: t("onboarding.scan.checkIndex"), variant: "secondary" })}
        </div>
      </details>
      <p id="recovery-accounts-result" role="status"></p>`;

const recoveryAccountsStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="recovery-accounts" hidden>
    ${flowBack(t("onboarding.back.passphrase"))}
    ${stepHead("wallet", t("onboarding.scan.title"))}
    <div class="onboarding-fields">
${recoveryScanFields()}
      ${networkConsequence()}
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "recover-accounts-button" },
        disabled: true,
        label: t("onboarding.scan.restore"),
      })}
    </div>
  </section>`;

const accountStep = (): string => `
  <section class="onboarding-step" data-onboarding-step="accounts" hidden>
    ${flowBack(t("onboarding.back.passphrase"))}
    ${stepHead("wallet", t("onboarding.account.title"))}
    <div class="onboarding-fields">
      <div class="onboarding-account" id="account-preview">
        <span class="onboarding-account-avatar">01</span>
        <span class="onboarding-account-copy">
          <strong data-preview-label></strong>
          <span data-preview-address>${th("onboarding.account.deriving")}</span>
        </span>
        <span class="onboarding-account-check" aria-hidden="true">${icon("check")}</span>
      </div>
      ${networkConsequence()}
      <p id="form-result" role="status"></p>
    </div>
    <div class="onboarding-step-cta">
      ${button({
        attributes: { id: "create-wallet-button" },
        disabled: true,
        label: t("onboarding.account.finish"),
        type: "submit",
      })}
    </div>
  </section>`;

const ledgerStep = (status: WalletStatus, ledgerAvailable = true): string =>
  ledgerAvailable
    ? `
  <section class="onboarding-step" data-onboarding-step="ledger" hidden>
    ${flowBack(t("onboarding.back.methods"))}
    ${stepHead("lock", t("onboarding.ledger.title"))}
    <form id="ledger-setup-form" class="onboarding-fields">
      ${passwordFields("ledger")}
      ${networkConsequence()}
      <p id="ledger-passphrase-result" role="status"></p>
      <div class="onboarding-step-cta">
        ${button({
          attributes: { "data-ledger-first-run": true, id: "ledger-setup-button" },
          disabled: !status.ready,
          label: t("onboarding.ledger.continue"),
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
  <section class="screen flow gate onboarding-wizard" aria-label="${th("onboarding.wizard.label")}">
    <form id="create-form" class="onboarding-flow" data-wallet-ready="${status.ready === true ? "true" : "false"}" novalidate>
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
