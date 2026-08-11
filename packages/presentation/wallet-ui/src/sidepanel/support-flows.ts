/**
 * Secondary wallet-management flows kept separate from account/network flows
 * so each production template module remains small enough to audit directly.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { emptyState } from "@mc-wallet/ui-kit/content";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { textField } from "@mc-wallet/ui-kit/fields";
import type { ConnectedSite, WalletStatus } from "../popup/responses";
import { accountLabel, copyButton, flowHeader, flowScreen } from "./parts";

/**
 * Backup flow: export or restore non-secret wallet data. Never includes the
 * vault or any key material.
 */
export const backupFlow = (status: WalletStatus): string => {
  const hasLedgerAccount = status.accounts.some((account) => account.derivation.kind === "ledger");
  return (
    flowHeader("Backup & restore", status, "Preferences, labels, and contacts") +
    flowScreen(
      "backup",
      `<section class="section">
      <p class="eyebrow">Export</p>
      <p class="hint">Downloads tokens, contacts, labels, and settings as JSON. Your recovery phrase and keys are never included.</p>
      ${
        hasLedgerAccount
          ? '<p class="review-flag" role="note">Ledger accounts are not restored by this JSON backup or by MC Wallet’s recovery phrase. Recover them with your Ledger device and its Ledger recovery phrase.</p>'
          : ""
      }
      ${button({
        attributes: { id: "backup-export" },
        icon: "receive",
        label: "Download backup",
        variant: "secondary",
      })}
      <p id="backup-result" role="status"></p>
    </section>
    <section class="section">
      <p class="eyebrow">Restore</p>
      <p class="hint">Replaces current preferences with a backup file exported from this wallet.</p>
      ${textField({
        accept: "application/json",
        attributes: { id: "backup-file" },
        label: "Backup file",
        name: "backupFile",
        type: "file",
      })}
      ${button({
        attributes: { id: "backup-import" },
        icon: "check",
        label: "Restore backup",
        variant: "secondary",
      })}
    </section>`,
    )
  );
};

/**
 * Connected sites flow: list origins with active grants and revoke access.
 */
export const connectedSitesFlow = (status: WalletStatus, sites: readonly ConnectedSite[]): string =>
  flowHeader("Connected sites", status, `${sites.length} connected`) +
  flowScreen(
    "connected-sites",
    `<section class="section">
      <p class="hint">Connected sites can see your granted account addresses. Revoke any you no longer trust; the site is asked to reconnect next time.</p>
      ${
        sites.length === 0
          ? emptyState(
              "No sites are connected yet. Approving a connection request lists the site here.",
            )
          : `<ul class="address-book">${sites
              .map(
                (site) => `<li>
                    <div class="stack-tight">
                      <strong class="request-origin">${escapeHtml(site.origin)}</strong>
                      <span class="hint">${site.accountCount} account${site.accountCount === 1 ? "" : "s"} shared</span>
                    </div>
                    ${iconButton({
                      attributes: { "data-revoke-origin": site.origin },
                      icon: "x",
                      label: `Revoke ${site.origin}`,
                      tone: "danger",
                    })}
                  </li>`,
              )
              .join("")}</ul>`
      }
      <p id="connected-sites-result" role="status"></p>
    </section>`,
  );

/**
 * Address book flow: save and reuse recipient addresses for this network.
 */
export const addressBookFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string => {
  const addresses =
    preferences?.addressBook.filter((entry) => entry.networkId === status.networkId) ?? [];
  return (
    flowHeader("Address book", status, `${addresses.length} saved`) +
    flowScreen(
      "address-book",
      `<section class="section">
        <form id="address-form">
          <input name="networkId" type="hidden" value="${escapeHtml(status.networkId)}" />
          ${textField({
            autocomplete: "off",
            label: "Label",
            name: "label",
            required: true,
          })}
          ${textField({
            autocomplete: "off",
            className: "mono",
            label: "Address",
            name: "address",
            placeholder: "0x…",
            required: true,
            spellcheck: false,
          })}
          <span class="hint">Saving an existing address updates its label.</span>
          ${button({
            icon: "check",
            label: "Save address",
            type: "submit",
            variant: "secondary",
          })}
          <p id="address-result" role="status"></p>
        </form>
      </section>
      <section class="section">
        <p class="eyebrow">Saved addresses</p>
        ${
          addresses.length === 0
            ? emptyState("No saved addresses yet. Save one to reuse it when sending.")
            : `<ul class="address-book">${addresses
                .map(
                  (entry) => `<li>
                    <div class="stack-tight">
                      <strong>${escapeHtml(entry.label)}</strong>
                      <code>${escapeHtml(accountLabel(entry.address))}</code>
                    </div>
                    ${copyButton(entry.address, `Copy ${entry.label}`)}
                    ${iconButton({
                      attributes: { "data-remove-address": entry.id },
                      icon: "x",
                      label: `Remove ${entry.label}`,
                      tone: "danger",
                    })}
                  </li>`,
                )
                .join("")}</ul>`
        }
      </section>`,
    )
  );
};
