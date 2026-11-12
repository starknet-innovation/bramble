/**
 * Secondary wallet-management flows kept separate from account/network flows
 * so each production template module remains small enough to audit directly.
 */

import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button, iconButton, switchControl } from "@bramble/ui-kit/controls";
import { textareaField, textField } from "@bramble/ui-kit/fields";
import { t, th } from "../../../i18n/messages";
import type { ConnectedSite, WalletStatus } from "../../../popup/responses/responses";
import { accountLabel, copyButton, flowHeader, flowScreen } from "../../shared/parts";

/**
 * What the connected-sites screen knows: the granted origins, or that the read
 * has not landed yet, or that it failed. A failed read is never shown as an
 * empty list (Sherlock 234): "no sites are connected" is a claim the wallet
 * can only make from an answer, and it would also hide the revoke controls.
 */
export type ConnectedSitesState = readonly ConnectedSite[] | "error" | "loading";

const connectedSiteRows = (sites: readonly ConnectedSite[]): string =>
  sites.length === 0
    ? emptyState(t("shell.sites.empty"))
    : `<ul class="address-book">${sites
        .map(
          (site) => `<li>
              <div class="stack-tight">
                <strong class="request-origin">${escapeHtml(site.origin)}</strong>
                <span class="hint">${th(site.accountCount === 1 ? "shell.sites.sharedOne" : "shell.sites.sharedMany", { count: String(site.accountCount) })}</span>
              </div>
              ${iconButton({
                attributes: { "data-revoke-origin": site.origin },
                icon: "x",
                label: t("shell.sites.revoke", { origin: site.origin }),
                tone: "danger",
              })}
            </li>`,
        )
        .join("")}</ul>`;

// The retry reuses the shell's reload control, which re-reads the status and
// re-hydrates the active screen.
const connectedSitesBody = (sites: ConnectedSitesState): string => {
  if (sites === "loading") return emptyState(t("shell.sites.loading"));
  if (sites === "error") {
    return `<div class="panel-error">
      ${emptyState(t("shell.sites.loadFailed"))}
      ${button({
        attributes: { "aria-label": t("shell.sites.retryLabel"), "data-reload-balances": true },
        icon: "refresh",
        label: t("shell.tryAgain"),
        size: "small",
        variant: "ghost",
      })}
    </div>`;
  }
  return connectedSiteRows(sites);
};

/**
 * Connected sites flow: list origins with active grants and revoke access.
 * The count and the empty state appear only once the list has been read.
 */
export const connectedSitesFlow = (status: WalletStatus, sites: ConnectedSitesState): string =>
  flowHeader(
    t("shell.header.connectedSites"),
    status,
    Array.isArray(sites) ? t("shell.sites.count", { count: String(sites.length) }) : undefined,
  ) +
  flowScreen(
    "connected-sites",
    `<section class="section">
      <p class="hint">${th("shell.sites.hint")}</p>
      ${connectedSitesBody(sites)}
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
    flowHeader(
      t("shell.addressBook.title"),
      status,
      t("shell.addressBook.count", { count: String(addresses.length) }),
    ) +
    flowScreen(
      "address-book",
      `<section class="section">
        <form id="address-form">
          <input name="networkId" type="hidden" value="${escapeHtml(status.networkId)}" />
          ${textField({
            autocomplete: "off",
            label: t("shell.addressBook.label"),
            name: "label",
            required: true,
          })}
          ${textField({
            autocomplete: "off",
            className: "mono",
            label: t("shell.field.address"),
            name: "address",
            placeholder: "0x…",
            required: true,
            spellcheck: false,
          })}
          <span class="hint">${th("shell.addressBook.updateHint")}</span>
          ${switchControl({
            attributes: { id: "advanced-address" },
            label: t("receive.advanced"),
          })}
          <div class="address-advanced-fields" id="address-advanced-fields" hidden>
            ${textareaField({
              autocomplete: "off",
              className: "mono",
              hint: t("shell.addressBook.cardHint"),
              label: t("receive.payload.card"),
              name: "walletCard",
              placeholder: "mcw:contact:1:…",
              rows: 3,
              spellcheck: false,
            })}
            ${textField({
              autocomplete: "off",
              className: "mono",
              hint: t("shell.addressBook.coordinationHint"),
              label: t("receive.coordination.title"),
              name: "nostrPublicKey",
              placeholder: t("shell.addressBook.nostrPlaceholder"),
              spellcheck: false,
            })}
            ${textField({
              autocomplete: "off",
              className: "mono",
              hint: t("shell.addressBook.signerHint"),
              label: t("receive.signer.title"),
              name: "publicKeyX",
              placeholder: "0x…",
              spellcheck: false,
            })}
          </div>
          ${button({
            icon: "check",
            label: t("shell.addressBook.save"),
            type: "submit",
            variant: "secondary",
          })}
          <p id="address-result" role="status"></p>
        </form>
      </section>
      <section class="section">
        <p class="eyebrow">${th("shell.addressBook.savedTitle")}</p>
        ${
          addresses.length === 0
            ? emptyState(t("shell.addressBook.empty"))
            : `<ul class="address-book">${addresses
                .map(
                  (entry) => `<li>
                    <div class="stack-tight">
                      <strong>${escapeHtml(entry.label)}</strong>
                      <code>${escapeHtml(accountLabel(entry.address))}</code>
                      ${entry.publicKeyX ? `<span class="hint">${th("shell.addressBook.signerKey", { key: accountLabel(entry.publicKeyX) })}</span>` : ""}
                      ${entry.nostrPublicKey ? `<span class="hint">${th("shell.addressBook.coordinationReady")}</span>` : ""}
                    </div>
                    ${copyButton(entry.address, t("shell.addressBook.copy", { label: entry.label }))}
                    ${entry.publicKeyX ? copyButton(entry.publicKeyX, t("shell.addressBook.copySigner", { label: entry.label })) : ""}
                    ${
                      entry.nostrPublicKey
                        ? copyButton(
                            entry.nostrPublicKey,
                            t("shell.addressBook.copyCoordination", { label: entry.label }),
                          )
                        : ""
                    }
                    ${iconButton({
                      attributes: { "data-remove-address": entry.id },
                      icon: "x",
                      label: t("shell.addressBook.remove", { label: entry.label }),
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
