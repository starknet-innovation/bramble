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
import { escapeHtml } from "../../shared/html";
import { icon } from "../icons";
import { accountLabel } from "../parts";
import type { LedgerCandidate } from "./onboard-session";
import type { LedgerDeviceChoice } from "./sign-session";

// The dismiss control rendered in every onboarding state so the full-screen
// overlay can always be exited (chooser / connect / reading / picker / error) —
// returning the user to the screen behind it (first-run choice or the account
// screen) and, on first run, clearing the captured setup unlock secret.
const ledgerOnboardCancel = (): string =>
  '<button class="ghost small" data-ledger-onboard-cancel type="button">Cancel</button>';

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
 * The add-account chooser: three explicit routes so a Ledger add is never
 * misrouted into recovery-phrase derivation. Each row carries a `data-add-kind`
 * the binder dispatches on. Rendered in the centred overlay shell so it reads as
 * a deliberate first step of the add-account flow.
 */
export const addAccountChooser = (): string => `
  <div class="onboard-hero">
    <div class="gate-head">
      <h1>Add an account</h1>
      <p class="lede">Choose how to add an account to this wallet.</p>
    </div>
    <div class="add-account-chooser" role="group" aria-label="Add an account">
      <button class="menu-row" data-add-kind="hd" type="button">
        <span class="menu-icon">${icon("plus")}</span>
        <span class="menu-copy"><strong>New account</strong><span class="hint">Derive the next account from your recovery phrase.</span></span>
        <span class="menu-chevron">${icon("chevronRight")}</span>
      </button>
      <button class="menu-row" data-add-kind="import" type="button">
        <span class="menu-icon">${icon("link")}</span>
        <span class="menu-copy"><strong>Import a private key</strong><span class="hint">Add an account from a raw Starknet key.</span></span>
        <span class="menu-chevron">${icon("chevronRight")}</span>
      </button>
      <button class="menu-row" data-add-kind="ledger" type="button">
        <span class="menu-icon">${icon("shield")}</span>
        <span class="menu-copy"><strong>Connect a Ledger</strong><span class="hint">Add a hardware account — its key never leaves the device.</span></span>
        <span class="menu-chevron">${icon("chevronRight")}</span>
      </button>
    </div>
    <div class="onboard-actions">${ledgerOnboardCancel()}</div>
  </div>`;

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
    `<button class="primary" data-ledger-onboard-connect type="button">${icon("shield")}Connect a Ledger</button>
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
        .map(
          (device) =>
            `<button class="menu-row" data-ledger-device="${escapeHtml(device.id)}" type="button">
              <span class="menu-icon">${icon("shield")}</span>
              <span class="menu-copy"><strong>${escapeHtml(device.label)}</strong></span>
              <span class="menu-chevron">${icon("chevronRight")}</span>
            </button>`,
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
    `<button class="secondary" data-ledger-onboard-connect type="button">${icon("refresh")}Try again</button>
      ${ledgerOnboardCancel()}`,
  );

const deployedLabel = (deployed: boolean | null): string =>
  deployed === null
    ? '<span class="hint">Checking…</span>'
    : deployed
      ? '<span class="pill">Deployed</span>'
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
    <span class="pill">Already in this wallet</span>
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
      ? '<p class="empty">No accounts read from the device yet.</p>'
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
    <button class="ghost small" data-ledger-load-more type="button">${icon("plus")}Show more</button>
    <div class="onboard-actions">
      <button class="primary" data-ledger-add-selected type="button"${count === 0 ? " disabled" : ""}>${icon("plus")}${addLabel}</button>
      ${ledgerOnboardCancel()}
    </div>
  </div>`;
};
