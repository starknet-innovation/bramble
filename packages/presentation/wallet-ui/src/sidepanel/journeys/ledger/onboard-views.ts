/**
 * Pure templates for the Ledger onboarding subflow: the add-account chooser
 * (HD / import / Connect Ledger / Restore a Ready Ledger account), the connect
 * and reading device states, the onboarding error state, and the multi-index
 * account picker showing each candidate's address, on-chain deployed status,
 * and balance. Logic-free string builders; all dynamic text is escaped and all
 * bindings live in the onboarding UI binder.
 *
 * The chooser and the connect/reading/error states share one vertically-centred
 * overlay shell (`onboard-hero`) so they read as deliberate, evenly-spaced
 * screens instead of content bunched at the top; the picker keeps a top-aligned,
 * scrollable layout because its list can grow past the viewport. All spacing is
 * drawn from the scale tokens in the stylesheet — no inline pixel values here.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState, pill } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { menuRow } from "@bramble/ui-kit/navigation";
import {
  LEDGER_EIP2645_APPLICATION,
  type LedgerEip2645Application,
  READY_EIP2645_APPLICATION,
} from "@bramble/wallet-model/ledger-path";
import { icon } from "../../shared/icons";
import { accountLabel, accountsDetectedText } from "../../shared/parts";
import type { LedgerOnboardAddKind } from "./onboard-session";
import {
  type LedgerCandidate,
  ledgerCandidateActive,
  ledgerCandidateSelectable,
} from "./onboard-types";
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

// One chooser tile: a single click routes immediately — no separate
// select-then-confirm step. The chevron marks each tile as a direct action.
const chooserOption = (
  kind: LedgerOnboardAddKind,
  iconName: "book" | "link" | "shield" | "users" | "wallet",
  label: string,
  supportingText: string,
): string => `
    <button class="add-account-option" data-add-kind="${kind}" type="button">
      <span class="add-account-option-icon">${icon(iconName)}</span>
      <span class="add-account-option-copy"><strong>${label}</strong><span>${supportingText}</span></span>
      <span class="add-account-option-check">${icon("chevronRight")}</span>
    </button>`;

/**
 * The shared add-account chooser used by both the account drawer and Manage
 * accounts. Each tile routes on its own click.
 */
export const addAccountChooser = (): string => {
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
      ${chooserOption("regular", "wallet", "Regular account", "Create the next account from this wallet’s recovery phrase.")}
      ${chooserOption("ledger", "shield", "Ledger account", "Connect a Ledger and pick its accounts, new or existing.")}
      ${chooserOption("restore-ready-ledger", "shield", "Restore a Ready Ledger account", "Bring over a Ledger account created in Ready (Argent X). Reads your device at Ready’s derivation path.")}
      ${chooserOption("multisig", "users", "Multisig account", "Create or add a shared account controlled by multiple signers.")}
      ${chooserOption("import", "link", "Import an existing account", "Bring accounts you already own: a recovery phrase or a private key.")}
    </div>
  </div>`;
};

/**
 * The in-wallet second stage of "Import an existing account": a recovery
 * phrase (retained for later re-derivation, with its own scan) or a single raw
 * private key. Ledger import lives on the top-level Ledger route, whose picker
 * already finds existing device accounts.
 */
export const importAccountChooser = (): string => {
  return `
  <div class="onboard-hero add-account-hero">
    <header class="add-account-header">
      <h1>Import an existing account</h1>
      ${iconButton({
        attributes: { "data-ledger-onboard-cancel": true },
        icon: "x",
        label: "Close Add account",
        variant: "ghost",
      })}
    </header>
    <div class="add-account-chooser" role="group" aria-label="Import an existing account">
      ${chooserOption("import-phrase", "book", "Recovery phrase", "Import accounts from another wallet's 12 or 24 words.")}
      ${chooserOption("import-key", "link", "Private key", "Import a single account from its raw Starknet key.")}
    </div>
    <div class="onboard-actions">
      ${button({
        attributes: { "data-add-back": true },
        label: "Back",
        variant: "ghost",
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
// An inactive Ready row keeps its checkbox but disabled: importing it would
// deploy a brand-new Ready account, which this wallet does not do. Every other
// row is a labelled checkbox keyed on its account id.
const candidateRow = (candidate: LedgerCandidate, selected: readonly string[]): string => {
  const id = candidate.account.id;
  if (candidate.duplicate) {
    return `
  <li class="allowance-row is-duplicate">
    <div class="allowance-copy">${candidateMeta(candidate)}</div>
    ${pill("Already in this wallet")}
  </li>`;
  }
  const disabled = ledgerCandidateSelectable(candidate) ? "" : " disabled";
  const checked = selected.includes(id) ? " checked" : "";
  return `
  <li class="allowance-row">
    <label class="select-row">
      <input class="select-check" type="checkbox" data-ledger-toggle="${escapeHtml(id)}"${checked}${disabled} />
      <span class="allowance-copy">${candidateMeta(candidate)}</span>
    </label>
  </li>`;
};

const candidateRows = (
  candidates: readonly LedgerCandidate[],
  selected: readonly string[],
): string =>
  candidates.length === 0
    ? emptyState("No accounts read from the device yet.")
    : `<ul class="allowance-list">${candidates.map((candidate) => candidateRow(candidate, selected)).join("")}</ul>`;

// One contract-family group under Bramble's path scheme: a native disclosure
// whose summary carries the family name and a light detected-count. The runtime
// preserves each group's open/closed state across repaints and opens a group
// when activity appears. The Argent group holds accounts an earlier Bramble
// release created with the Argent contract at Bramble's own path — never a
// Ready account, which lives at a different path (see the restore route).
const candidateGroup = (
  contractType: "argent" | "openzeppelin",
  candidates: readonly LedgerCandidate[],
  selected: readonly string[],
): string => {
  const rows = candidates.filter(
    (candidate) => candidate.account.accountContractType === contractType,
  );
  const detected = rows.filter(ledgerCandidateActive).length;
  const label = contractType === "argent" ? "Argent accounts" : "Bramble accounts";
  return `
  <details class="disclosure account-group" data-account-group="${contractType}">
    <summary>${label}${detected === 0 ? "" : `<span class="hint">${accountsDetectedText(detected)}</span>`}</summary>
    <div class="disclosure-body">${candidateRows(rows, selected)}</div>
  </details>`;
};

// The Ready-restore picker is one flat list — every candidate was read at
// Ready's path and derived to the Argent contract Ready deploys — with the
// detected count inline. Not a disclosure (no `data-account-group`), so the
// runtime's open/closed bookkeeping leaves it alone. Ready numbers a new Ledger
// account after every account already in that wallet, so a restored account
// often sits past the first page.
const readyCandidates = (
  candidates: readonly LedgerCandidate[],
  selected: readonly string[],
): string => {
  const detected = candidates.filter(ledgerCandidateActive).length;
  return `
  <div class="account-group" data-ready-accounts>
    <p class="hint">Ready accounts${detected === 0 ? "" : ` · ${accountsDetectedText(detected)}`}</p>
    ${candidateRows(candidates, selected)}
  </div>`;
};

const pickerCopy = (
  application: LedgerEip2645Application,
): { readonly heading: string; readonly lede: string } =>
  application === READY_EIP2645_APPLICATION
    ? {
        heading: "Select Ready accounts",
        lede: "Each address is read from your device at Ready’s derivation path; Ready accounts with on-chain activity are preselected. Ready numbers Ledger accounts after the accounts already in that wallet, so yours may be a few pages in — use Show more.",
      }
    : {
        heading: "Select accounts",
        lede: "Each address is read from your device; accounts with on-chain activity are preselected.",
      };

/**
 * The multi-select account picker: one row per enumerated candidate with its
 * address, deployed status, balance, and a selection checkbox (duplicate rows
 * show a badge instead and cannot be selected). "Show more" reads the next page
 * of indices from the device; "Add selected" adds every checked index at once
 * and reflects a running selected-count. Callers stream candidates in as they
 * resolve. A Cancel control is always rendered so the picker stage can be
 * dismissed without adding anything. `application` is the path scheme the
 * candidates were read at: Bramble's groups them by contract family, Ready's
 * shows the single flat list of Ready accounts.
 */
export const ledgerAccountPicker = (
  candidates: readonly LedgerCandidate[],
  selected: readonly string[] = [],
  message?: string,
  application: LedgerEip2645Application = LEDGER_EIP2645_APPLICATION,
): string => {
  const list =
    application === READY_EIP2645_APPLICATION
      ? readyCandidates(candidates, selected)
      : `${candidateGroup("openzeppelin", candidates, selected)}${candidateGroup("argent", candidates, selected)}`;
  const copy = pickerCopy(application);
  const count = selected.length;
  const addLabel = count > 0 ? `Add selected (${count})` : "Add selected";
  return `
  <div class="onboard-picker">
    <div class="gate-head">
      <h1>${copy.heading}</h1>
      <p class="lede">${copy.lede}</p>
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
