/**
 * Pure templates for the Ledger onboarding subflow: the add-account chooser
 * (HD / import / Connect Ledger), the connect and reading device states, and the
 * multi-index account picker showing each candidate's address, on-chain deployed
 * status, and balance. Logic-free string builders; all dynamic text is escaped
 * and all bindings live in the onboarding UI binder.
 */
import { escapeHtml } from "../../shared/html";
import { icon } from "../icons";
import { accountLabel } from "../parts";
import type { LedgerCandidate } from "./onboard-session";

/**
 * The add-account chooser: three explicit routes so a Ledger add is never
 * misrouted into recovery-phrase derivation. Each row carries a `data-add-kind`
 * the binder dispatches on.
 */
export const addAccountChooser = (): string => `
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
  </div>`;

/**
 * The pre-picker device states. `connect` needs a user gesture; `reading` is the
 * silent enumeration wait; `error` shows a catalog message with a retry.
 */
export const ledgerConnectPrompt = (): string => `
  <div class="review-panel" role="note">
    <p class="hint">Your browser will ask you to select your Ledger. This only connects it — no funds move.</p>
    <button class="primary" data-ledger-onboard-connect type="button">${icon("shield")}Connect a Ledger</button>
  </div>`;

/**
 * The silent enumeration progress state.
 */
export const ledgerReadingPrompt = (): string => `
  <div class="review-panel" role="note">
    <p class="hint">Reading accounts from your device…</p>
  </div>`;

/**
 * A device error during onboarding, with the catalog message and a retry.
 */
export const ledgerOnboardError = (message: string): string => `
  <div class="review-panel" role="note">
    <p class="review-flag">${escapeHtml(message)}</p>
    <button class="secondary" data-ledger-onboard-connect type="button">${icon("refresh")}Try again</button>
  </div>`;

const deployedLabel = (deployed: boolean | null): string =>
  deployed === null
    ? '<span class="hint">Checking…</span>'
    : deployed
      ? '<span class="pill">Deployed</span>'
      : '<span class="hint">Not deployed — needs funding before its first transaction</span>';

const balanceLabel = (balance: string | null): string =>
  balance === null ? '<span class="hint">balance unavailable</span>' : escapeHtml(balance);

const candidateRow = (candidate: LedgerCandidate): string => {
  const { account } = candidate;
  const controls = candidate.duplicate
    ? '<span class="pill">Already in this wallet</span>'
    : `<button class="secondary small" data-ledger-select="${escapeHtml(String(account.derivation.accountIndex))}" type="button">${icon("plus")}Add</button>`;
  return `
  <li class="allowance-row">
    <div class="allowance-copy">
      <strong>Account ${escapeHtml(String(account.derivation.accountIndex))}</strong>
      <code>${escapeHtml(accountLabel(account.address))}</code>
      <span class="hint">${deployedLabel(candidate.deployed)} · ${balanceLabel(candidate.balance)}</span>
    </div>
    ${controls}
  </li>`;
};

/**
 * The account picker: one row per enumerated candidate with its address,
 * deployed status, balance, and an Add control (disabled/duplicate rows show a
 * badge instead). Callers stream candidates in as they resolve.
 */
export const ledgerAccountPicker = (candidates: readonly LedgerCandidate[]): string =>
  candidates.length === 0
    ? '<p class="empty">No accounts read from the device yet.</p>'
    : `<ul class="allowance-list">${candidates.map(candidateRow).join("")}</ul>`;
