/**
 * Multisig declaration and deployment screen, split from the list/detail
 * templates so each security-sensitive renderer stays directly auditable.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { sameFelt } from "../starknet/networks";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState, pill } from "../ui/content";
import { button } from "../ui/controls";
import { inputControl, textField } from "../ui/fields";
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

/**
 * Renders the deploy form for a new multisig from the pinned class, including
 * the declare-first path when the class is missing on the active network.
 */
export const multisigDeployFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  declared: boolean | "error" | null,
  preferences: WalletPreferences | null = null,
): string => {
  if (!account) {
    return (
      flowHeader("Deploy multisig", status) + flowScreen("multisig-deploy", noAccountEmpty(status))
    );
  }
  const candidates = signerCandidates(status, preferences);
  return (
    flowHeader("Deploy multisig", status) +
    flowScreen(
      "multisig-deploy",
      `<section class="section">
      ${
        declared === false
          ? `<div class="row">${pill("Class not declared")}</div>
             <p class="hint">The multisig class is not declared on ${escapeHtml(status.network)} yet. Declaring is a one-time, fee-paying transaction from your account; afterwards anyone can deploy from the same class.</p>
             ${button({
               attributes: { id: "multisig-declare" },
               icon: "send",
               label: "Declare multisig class",
               variant: "secondary",
             })}
             <p id="multisig-declare-result" role="status"></p>`
          : declared === "error"
            ? `<div class="row">${pill("Status unavailable")}</div>
               <p class="hint">Could not check whether the multisig class is declared on ${escapeHtml(status.network)} — the network may be unreachable.</p>
               ${button({
                 attributes: { id: "multisig-class-retry" },
                 icon: "refresh",
                 label: "Retry",
                 variant: "secondary",
               })}`
            : declared === null
              ? '<p class="hint">Checking whether the multisig class is declared on this network…</p>'
              : ""
      }
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
            disabled: declared !== true,
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
