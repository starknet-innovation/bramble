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
          ${switchControl({
            attributes: { id: "address-pro" },
            label: "Pro",
          })}
          <div class="address-pro-fields" id="address-pro-fields" hidden>
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
              hint: "Authenticates encrypted multisig intent handoffs from this contact.",
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
            ? emptyState("No saved addresses yet. Save one to reuse it when sending.")
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
