/**
 * Secondary wallet-management flows kept separate from account/network flows
 * so each production template module remains small enough to audit directly.
 */

import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button, iconButton, switchControl } from "@bramble/ui-kit/controls";
import { textareaField, textField } from "@bramble/ui-kit/fields";
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
    ? emptyState("No sites are connected yet. Approving a connection request lists the site here.")
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
        .join("")}</ul>`;

// The retry reuses the shell's reload control, which re-reads the status and
// re-hydrates the active screen.
const connectedSitesBody = (sites: ConnectedSitesState): string => {
  if (sites === "loading") return emptyState("Loading connected sites…");
  if (sites === "error") {
    return `<div class="panel-error">
      ${emptyState("Couldn't load connected sites.")}
      ${button({
        attributes: { "aria-label": "Retry loading connected sites", "data-reload-balances": true },
        icon: "refresh",
        label: "Try again",
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
    "Connected sites",
    status,
    Array.isArray(sites) ? `${sites.length} connected` : undefined,
  ) +
  flowScreen(
    "connected-sites",
    `<section class="section">
      <p class="hint">Connected sites see the addresses you granted. Revoke any you no longer trust.</p>
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
          ${switchControl({
            attributes: { id: "advanced-address" },
            label: "Advanced",
          })}
          <div class="address-advanced-fields" id="address-advanced-fields" hidden>
            ${textareaField({
              autocomplete: "off",
              className: "mono",
              hint: "Paste a shared Bramble card to fill the address, signer key, and coordination identity together.",
              label: "Wallet card",
              name: "walletCard",
              placeholder: "mcw:contact:1:…",
              rows: 3,
              spellcheck: false,
            })}
            ${textField({
              autocomplete: "off",
              className: "mono",
              hint: "Authenticates encrypted multisig transaction handoffs from this contact.",
              label: "Coordination public key",
              name: "nostrPublicKey",
              placeholder: "64-character Nostr public key",
              spellcheck: false,
            })}
            ${textField({
              autocomplete: "off",
              className: "mono",
              hint: "Lets this contact appear in multisig signer pickers.",
              label: "Signer public key",
              name: "publicKeyX",
              placeholder: "0x…",
              spellcheck: false,
            })}
          </div>
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
            ? emptyState("No saved address yet")
            : `<ul class="address-book">${addresses
                .map(
                  (entry) => `<li>
                    <div class="stack-tight">
                      <strong>${escapeHtml(entry.label)}</strong>
                      <code>${escapeHtml(accountLabel(entry.address))}</code>
                      ${entry.publicKeyX ? `<span class="hint">Signer key ${escapeHtml(accountLabel(entry.publicKeyX))}</span>` : ""}
                      ${entry.nostrPublicKey ? `<span class="hint">Secure coordination ready</span>` : ""}
                    </div>
                    ${copyButton(entry.address, `Copy ${entry.label}`)}
                    ${entry.publicKeyX ? copyButton(entry.publicKeyX, `Copy ${entry.label} signer public key`) : ""}
                    ${entry.nostrPublicKey ? copyButton(entry.nostrPublicKey, `Copy ${entry.label} coordination public key`) : ""}
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
