/**
 * Multisig declaration and deployment screen, split from the list/detail
 * templates so each security-sensitive renderer stays directly auditable.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { emptyState, pill } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { inputControl, textField } from "@mc-wallet/ui-kit/fields";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { MultisigClassState } from "../popup/multisig-responses";
import type { WalletStatus } from "../popup/responses";
import { icon } from "./icons";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  hardwareBadge,
  noAccountEmpty,
} from "./parts";

type SignerCandidate = {
  readonly account?: AccountRef;
  readonly address: string;
  readonly label: string;
  readonly source: "Address book" | "My accounts";
};

const signerCandidates = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): readonly SignerCandidate[] => {
  const accounts = status.accounts
    .filter((stored) => stored.networkId === status.networkId)
    .map((stored) => ({
      account: stored,
      address: stored.address,
      label: accountDisplayName(stored, preferences),
      source: "My accounts" as const,
    }));
  const contacts = (preferences?.addressBook ?? [])
    .filter(
      (entry) =>
        entry.networkId === status.networkId &&
        !accounts.some((stored) => sameFelt(stored.address, entry.address)),
    )
    .map((entry) => ({
      address: entry.address,
      label: entry.label,
      source: "Address book" as const,
    }));
  return [...accounts, ...contacts];
};

const signerOption = (candidate: SignerCandidate, selected: boolean): string => `
  <button class="multisig-signer-option" type="button"
    aria-pressed="${selected}"
    data-signer-insert="${escapeHtml(candidate.address)}"
    data-signer-toggle="${escapeHtml(candidate.address)}"
    data-signer-label="${escapeHtml(candidate.label)}"
    data-signer-search="${escapeHtml(`${candidate.label} ${candidate.address}`.toLowerCase())}">
    <span class="send-recipient-avatar">${accountAvatar(candidate.address)}</span>
    <span class="send-recipient-copy">
      <strong>${escapeHtml(candidate.label)}${candidate.account ? hardwareBadge(candidate.account) : ""}</strong>
      <span>${escapeHtml(candidate.source)} · <code>${escapeHtml(accountLabel(candidate.address))}</code></span>
    </span>
    <span class="multisig-signer-check">${icon("check")}</span>
  </button>`;

const classDeclarationGate = (
  status: WalletStatus,
  state: MultisigClassState | "error" | null,
): string => {
  if (state === null) {
    return '<p class="hint">Checking whether the multisig class is declared on this network…</p>';
  }
  if (state === "error") {
    return `<div class="row">${pill("Status unavailable")}</div>
      <p class="hint">Could not check whether the multisig class is declared on ${escapeHtml(status.network)} — the network may be unreachable.</p>
      ${button({
        attributes: { id: "multisig-class-retry" },
        icon: "refresh",
        label: "Retry",
        variant: "secondary",
      })}`;
  }
  if (state.declared) {
    return "";
  }
  if (state.declarationPending) {
    const progress = state.transactionHash
      ? `Declaration ${accountLabel(state.transactionHash)} was submitted. Waiting for ${escapeHtml(status.network)} to confirm the class before deployment is enabled.`
      : "The declaration is waiting for your authorization. Complete the wallet or Ledger prompt to submit it.";
    return `<div class="row">${pill("Declaration in progress")}</div>
      <p class="hint">${progress}</p>
      ${button({
        attributes: { id: "multisig-declare-pending" },
        disabled: true,
        icon: "send",
        label: state.transactionHash ? "Waiting for confirmation" : "Waiting for authorization",
        variant: "secondary",
      })}
      <p id="multisig-declare-result" role="status" aria-live="polite">${progress}</p>`;
  }
  return `<div class="row">${pill("Class not declared")}</div>
    <p class="hint">The multisig class is not declared on ${escapeHtml(status.network)} yet. Declaring is a one-time, fee-paying transaction from your account; afterwards anyone can deploy from the same class.</p>
    ${button({
      attributes: { id: "multisig-declare" },
      icon: "send",
      label: "Declare multisig class",
      variant: "secondary",
    })}
    <p id="multisig-declare-result" role="status" aria-live="polite"></p>`;
};

/**
 * Renders the deploy form for a new multisig from the pinned class, including
 * the declare-first path when the class is missing on the active network.
 */
export const multisigDeployFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  classState: MultisigClassState | "error" | null,
  preferences: WalletPreferences | null = null,
): string => {
  if (!account) {
    return (
      flowHeader("Deploy multisig", status) + flowScreen("multisig-deploy", noAccountEmpty(status))
    );
  }
  const candidates = signerCandidates(status, preferences);
  const classReady = classState !== null && classState !== "error" && classState.declared;
  return (
    flowHeader("Deploy multisig", status) +
    flowScreen(
      "multisig-deploy",
      `<section class="section">
      ${classDeclarationGate(status, classState)}
      <form id="multisig-deploy-form" data-stage="signers">
        <input name="signers" type="hidden" value="${escapeHtml(account.address)}" />
        <section class="multisig-deploy-stage" data-deploy-stage="signers">
          <div class="proposal-compose-intro">
            <span class="proposal-compose-mark">${icon("users")}</span>
            <div><strong>Choose the people who approve</strong><p>Select wallet accounts and saved contacts. You can add another address too.</p></div>
          </div>
          <label class="send-search">
            <span>Find a signer</span>
            <span class="send-search-control">${icon("search")}${inputControl({
              ariaLabel: "Search accounts and contacts",
              attributes: { id: "multisig-signer-search" },
              autocomplete: "off",
              placeholder: "Name or address",
              spellcheck: false,
              type: "search",
            })}</span>
          </label>
          <div class="multisig-signer-list">
            ${candidates.length > 0 ? candidates.map((candidate) => signerOption(candidate, sameFelt(candidate.address, account.address))).join("") : emptyState("No accounts or contacts are available.")}
          </div>
          <div class="multisig-custom-signer">
            ${inputControl({
              ariaLabel: "Custom signer address",
              attributes: { id: "multisig-custom-signer" },
              autocomplete: "off",
              className: "mono",
              placeholder: "Add another 0x… address",
              spellcheck: false,
            })}
            ${button({
              attributes: { id: "multisig-custom-signer-add" },
              icon: "plus",
              label: "Add",
              size: "small",
              variant: "secondary",
            })}
          </div>
          <p class="hint" id="multisig-selected-count">1 signer selected</p>
          ${button({
            attributes: { id: "multisig-signers-continue" },
            label: "Continue to approval rules",
            variant: "secondary",
          })}
        </section>
        <section class="multisig-deploy-stage" data-deploy-stage="rules" hidden>
          <button class="proposal-inline-back" id="multisig-signers-back" type="button">${icon("chevronLeft")} Edit signers</button>
          <div class="multisig-selected-summary" id="multisig-selected-summary"></div>
          ${textField({
            autocomplete: "off",
            inputmode: "numeric",
            label: "Approvals required",
            name: "quorum",
            required: true,
            value: "1",
          })}
          ${textField({
            autocomplete: "off",
            className: "mono",
            label: "Deployment salt",
            name: "salt",
            spellcheck: false,
            value: "0x0",
          })}
          <p class="hint">The signer set, approval threshold, class and salt deterministically derive this shared account address.</p>
          <div id="multisig-deploy-review" aria-live="polite"></div>
          ${button({
            disabled: !classReady,
            icon: "send",
            label: "Review deployment",
            type: "submit",
            variant: "secondary",
          })}
          <p id="multisig-deploy-result" role="status"></p>
        </section>
      </form>
    </section>`,
    )
  );
};
