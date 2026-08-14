/**
 * Pure templates for the Ledger onboarding subflow: the add-account chooser
 * (HD / import / Connect Ledger), the connect and reading device states, the
 * onboarding error state, and the multi-index account picker showing each
 * candidate's address, on-chain deployed status, and balance. Logic-free string
 * builders; all dynamic text is escaped and all bindings live in the onboarding
 * UI binder.
 *
 * The chooser and the connect/reading/error states share one vertically-centred
 * overlay shell (`onboard-hero`) so they read as deliberate, evenly-spaced
 * screens instead of content bunched at the top; the picker keeps a top-aligned,
 * scrollable layout because its list can grow past the viewport. All spacing is
 * drawn from the scale tokens in the stylesheet — no inline pixel values here.
 */
import { escapeHtml } from "@mc-wallet/core/html";
import { emptyState, pill } from "@mc-wallet/ui-kit/content";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { menuRow } from "@mc-wallet/ui-kit/navigation";
import { icon } from "../../shared/icons";
import { accountLabel } from "../../shared/parts";
import type { LedgerCandidate, LedgerOnboardAddKind } from "./onboard-types";
import type { LedgerDeviceChoice } from "./sign-session";

// The dismiss control rendered in every onboarding state so the full-screen
// overlay can always be exited (chooser / connect / reading / picker / error) —
// returning the user to the screen behind it (first-run choice or the account
// screen) and, on first run, clearing the captured setup unlock secret.
const ledgerOnboardCancel = (): string =>
  button({
    attributes: { "data-ledger-onboard-cancel": true },
    label: "Cancel",
    size: "small",
    variant: "ghost",
  });

// The shared vertically-centred overlay shell: a brand chip, a heading block,
// and the state's actions, stacked with the overlay's scale-token rhythm and
// centred in the panel viewport.
const onboardHero = (chip: string, head: string, actions: string): string => `
  <div class="onboard-hero">
    <span class="gate-brand">${chip}</span>
    <div class="gate-head">${head}</div>
    <div class="onboard-actions">${actions}</div>
  </div>`;

/**
 * The shared add-account chooser used by both the account drawer and Manage
 * accounts. Selection and confirmation are separate so a user can compare all
 * four signer models before committing to one route.
 */
export const addAccountChooser = (selected: LedgerOnboardAddKind | null = null): string => {
  const option = (
    kind: LedgerOnboardAddKind,
    iconName: "link" | "shield" | "users" | "wallet",
    label: string,
    supportingText: string,
  ): string => `
    <button class="add-account-option" data-add-kind="${kind}" type="button" aria-pressed="${selected === kind}">
      <span class="add-account-option-icon">${icon(iconName)}</span>
      <span class="add-account-option-copy"><strong>${label}</strong><span>${supportingText}</span></span>
      <span class="add-account-option-check">${icon("check")}</span>
    </button>`;
  return `
  <div class="onboard-hero add-account-hero">
    <header class="add-account-header">
      <h1>Add a new account</h1>
      ${iconButton({
        attributes: { "data-ledger-onboard-cancel": true },
        icon: "x",
        label: "Close Add account",
        variant: "ghost",
      })}
    </header>
    <div class="add-account-chooser" role="group" aria-label="Add an account">
      ${option("argent", "wallet", "Argent Account", "Create the next account from this wallet’s recovery phrase.")}
      ${option("openzeppelin", "wallet", "OpenZeppelin Account", "Create a compatibility account from this wallet’s recovery phrase.")}
      ${option("ledger-argent", "shield", "Argent Ledger Account", "Use a Ledger with an Argent account contract.")}
      ${option("ledger-openzeppelin", "shield", "OpenZeppelin Ledger Account", "Use a Ledger with an OpenZeppelin account contract.")}
      ${option("import", "link", "Import from private key", "Add an existing Starknet account from its raw key.")}
      ${option("multisig", "users", "Argent Multisig", "Create or add an Argent account controlled by multiple signers.")}
    </div>
    <div class="onboard-actions">
      ${button({
        attributes: { "data-add-continue": true },
        disabled: selected === null,
        label: "Continue",
      })}
    </div>
  </div>`;
};

/**
 * The pre-picker connect state: it needs a user gesture (the browser's device
 * picker), so it leads with the primary connect action. Centred in the overlay
 * shell with a Cancel escape hatch.
 */
export const ledgerConnectPrompt = (): string =>
  onboardHero(
    icon("shield"),
    `<h1>Connect a Ledger</h1>
      <p class="lede">Your browser will ask you to select your Ledger. This only connects it — no funds move.</p>`,
    `${button({
      attributes: { "data-ledger-onboard-connect": true },
      icon: "shield",
      label: "Connect a Ledger",
    })}
      ${ledgerOnboardCancel()}`,
  );

/**
 * The silent enumeration progress state, centred in the overlay shell.
 */
export const ledgerReadingPrompt = (): string =>
  onboardHero(
    icon("shield"),
    `<h1>Reading accounts</h1>
      <p class="lede">Reading accounts from your device…</p>`,
    ledgerOnboardCancel(),
  );

/**
 * Device chooser shown only when more than one origin-granted Ledger is
 * connected. Each button carries an opaque side-panel-local id; labels contain
 * device model/order only, never account or key material.
 */
export const ledgerDevicePicker = (devices: readonly LedgerDeviceChoice[]): string =>
  onboardHero(
    icon("shield"),
    `<h1>Choose your Ledger</h1>
      <p class="lede">More than one Ledger is connected. Select the device to read.</p>`,
    `<div class="add-account-chooser" role="group" aria-label="Connected Ledger devices">
      ${devices
        .map((device) =>
          menuRow({
            attributes: { "data-ledger-device": device.id },
            icon: "shield",
            label: device.label,
          }),
        )
        .join("")}
    </div>
    ${ledgerOnboardCancel()}`,
  );

/**
 * A device error during onboarding, with the catalog message and a retry,
 * centred in the overlay shell.
 */
export const ledgerOnboardError = (message: string): string =>
  onboardHero(
    icon("alert"),
    `<h1>Something went wrong</h1>
      <p class="review-flag">${escapeHtml(message)}</p>`,
    `${button({
      attributes: { "data-ledger-onboard-connect": true },
      icon: "refresh",
      label: "Try again",
      variant: "secondary",
    })}
      ${ledgerOnboardCancel()}`,
  );

const deployedLabel = (deployed: boolean | null): string =>
  deployed === null
    ? '<span class="hint">Checking…</span>'
    : deployed
      ? pill("Deployed")
      : '<span class="hint">Not deployed — needs funding before its first transaction</span>';

const balanceLabel = (balance: string | null): string =>
  balance === null ? '<span class="hint">balance unavailable</span>' : escapeHtml(balance);

const candidateMeta = (candidate: LedgerCandidate): string => {
  const index = escapeHtml(String(candidate.account.derivation.accountIndex));
  return `<strong>Account ${index}</strong>
      <code>${escapeHtml(accountLabel(candidate.account.address))}</code>
      <span class="hint">${deployedLabel(candidate.deployed)} · ${balanceLabel(candidate.balance)}</span>`;
};

// A duplicate row is non-selectable: it shows the "Already in this wallet" badge
// instead of a checkbox, so an account already in the vault can never be picked.
// Every other row is a labelled checkbox keyed on its account index.
const candidateRow = (candidate: LedgerCandidate, selected: readonly number[]): string => {
  const index = candidate.account.derivation.accountIndex;
  if (candidate.duplicate) {
    return `
  <li class="allowance-row is-duplicate">
    <div class="allowance-copy">${candidateMeta(candidate)}</div>
    ${pill("Already in this wallet")}
  </li>`;
  }
  const checked = selected.includes(index) ? " checked" : "";
  return `
  <li class="allowance-row">
    <label class="select-row">
      <input class="select-check" type="checkbox" data-ledger-toggle="${escapeHtml(String(index))}"${checked} />
      <span class="allowance-copy">${candidateMeta(candidate)}</span>
    </label>
  </li>`;
};

/**
 * The multi-select account picker: one row per enumerated candidate with its
 * address, deployed status, balance, and a selection checkbox (duplicate rows
 * show a badge instead and cannot be selected). "Show more" reads the next page
 * of indices from the device; "Add selected" adds every checked index at once
 * and reflects a running selected-count. Callers stream candidates in as they
 * resolve. A Cancel control is always rendered so the picker stage can be
 * dismissed without adding anything.
 */
export const ledgerAccountPicker = (
  candidates: readonly LedgerCandidate[],
  selected: readonly number[] = [],
  message?: string,
): string => {
  const list =
    candidates.length === 0
      ? emptyState("No accounts read from the device yet.")
      : `<ul class="allowance-list">${candidates.map((candidate) => candidateRow(candidate, selected)).join("")}</ul>`;
  const count = selected.length;
  const addLabel = count > 0 ? `Add selected (${count})` : "Add selected";
  return `
  <div class="onboard-picker">
    <div class="gate-head">
      <h1>Select accounts</h1>
      <p class="lede">Pick the accounts to add. Each address is read straight from your device.</p>
    </div>
    ${message ? `<p class="review-flag" role="alert">${escapeHtml(message)}</p>` : ""}
    ${list}
    ${button({
      attributes: { "data-ledger-load-more": true },
      icon: "plus",
      label: "Show more",
      size: "small",
      variant: "ghost",
    })}
    <div class="onboard-actions">
      ${button({
        attributes: { "data-ledger-add-selected": true },
        disabled: count === 0,
        icon: "plus",
        label: addLabel,
      })}
      ${ledgerOnboardCancel()}
    </div>
  </div>`;
};
