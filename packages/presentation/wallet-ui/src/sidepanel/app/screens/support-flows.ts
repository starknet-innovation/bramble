/**
 * Secondary wallet-management flows kept separate from account/network flows
 * so each production template module remains small enough to audit directly.
 */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { emptyState } from "@bramble/ui-kit/content";
import { button, iconButton, switchControl } from "@bramble/ui-kit/controls";
import { textareaField, textField } from "@bramble/ui-kit/fields";
import { icon } from "@bramble/ui-kit/icons";
import { addressLabel, addressText } from "@bramble/wallet-model/networks";
import type { ConnectedSite, WalletStatus } from "../../../popup/responses/responses";
import {
  accountDisplayName,
  accountIdAddress,
  copyButton,
  flowHeader,
  flowScreen,
} from "../../shared/parts";

/**
 * What the connected-sites screen knows: the granted origins, or that the read
 * has not landed yet, or that it failed. A failed read is never shown as an
 * empty list (Sherlock 234): "no sites are connected" is a claim the wallet
 * can only make from an answer, and it would also hide the revoke controls.
 */
export type ConnectedSitesState = readonly ConnectedSite[] | "error" | "loading";

type SiteEntry = { readonly id: string; readonly name: string; readonly address: string };

// Names each granted id as the wallet shows it elsewhere. Ids carry their own
// address, so an id the wallet no longer holds still shows which account it was.
const siteEntries = (
  site: ConnectedSite,
  status: WalletStatus,
  preferences: WalletPreferences | null,
  multisigs: readonly ArgentMultisigRecord[],
): readonly SiteEntry[] => [
  ...site.accountIds.map((id) => {
    const account = status.accounts.find((candidate) => candidate.id === id);
    return {
      address: account?.address ?? accountIdAddress(id),
      id,
      name: account ? accountDisplayName(account, preferences) : "Account no longer in this wallet",
    };
  }),
  ...site.multisigIds.map((id) => {
    const record = multisigs.find((candidate) => candidate.id === id);
    return {
      address: record?.address ?? accountIdAddress(id),
      id,
      name: record?.name ?? "Multisig account",
    };
  }),
];

const siteEntryRow = (origin: string, entry: SiteEntry): string => `<li>
    <div class="stack-tight">
      <strong>${escapeHtml(entry.name)}</strong>
      <code>${escapeHtml(addressLabel(entry.address))}</code>
    </div>
    ${button({
      attributes: {
        "aria-label": `Disconnect ${entry.name} from ${origin}`,
        "data-revoke-account": entry.id,
        "data-revoke-origin": origin,
      },
      label: "Disconnect",
      size: "small",
      tone: "danger",
      variant: "ghost",
    })}
  </li>`;

// A site with one account needs only that row's Disconnect, which also
// removes the site; "Disconnect all" appears once there is a choice.
const connectedSiteRow = (site: ConnectedSite, entries: readonly SiteEntry[]): string => `<li>
    <details class="disclosure connected-site" data-disclosure="site:${escapeHtml(site.origin)}">
      <summary>
        <span class="menu-copy">
          <strong class="request-origin">${escapeHtml(site.origin)}</strong>
          <span class="hint">${site.accountCount} account${site.accountCount === 1 ? "" : "s"} shared</span>
        </span>
        <span class="disclosure-mark">${icon("chevronRight")}</span>
      </summary>
      <div class="disclosure-body">
        <ul class="address-book">${entries.map((entry) => siteEntryRow(site.origin, entry)).join("")}</ul>
        ${
          entries.length > 1
            ? button({
                attributes: {
                  "aria-label": `Disconnect ${site.origin}`,
                  "data-revoke-origin": site.origin,
                },
                label: "Disconnect all",
                size: "small",
                tone: "danger",
                variant: "secondary",
              })
            : ""
        }
      </div>
    </details>
  </li>`;

const connectedSiteRows = (
  sites: readonly ConnectedSite[],
  status: WalletStatus,
  preferences: WalletPreferences | null,
  multisigs: readonly ArgentMultisigRecord[],
): string =>
  sites.length === 0
    ? emptyState("No sites are connected yet. Approving a connection request lists the site here.")
    : `<ul class="connected-sites">${sites
        .map((site) => connectedSiteRow(site, siteEntries(site, status, preferences, multisigs)))
        .join("")}</ul>`;

// The retry reuses the shell's reload control, which re-reads the status and
// re-hydrates the active screen.
const connectedSitesBody = (
  sites: ConnectedSitesState,
  status: WalletStatus,
  preferences: WalletPreferences | null,
  multisigs: readonly ArgentMultisigRecord[],
): string => {
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
  return connectedSiteRows(sites, status, preferences, multisigs);
};

/**
 * Connected sites flow: list origins with active grants; each expands to the
 * accounts it was given, disconnectable one at a time or all together. The
 * count and the empty state appear only once the list has been read.
 */
export const connectedSitesFlow = (
  status: WalletStatus,
  sites: ConnectedSitesState,
  preferences: WalletPreferences | null = null,
  multisigs: readonly ArgentMultisigRecord[] = [],
): string =>
  flowHeader(
    "Connected sites",
    status,
    Array.isArray(sites) ? `${sites.length} connected` : undefined,
  ) +
  flowScreen(
    "connected-sites",
    `<section class="section">
      <p class="hint">Connected sites see the accounts you shared. Disconnect any you no longer trust.</p>
      ${connectedSitesBody(sites, status, preferences, multisigs)}
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
                      <code>${escapeHtml(addressLabel(entry.address))}</code>
                      ${entry.publicKeyX ? `<span class="hint">Signer key ${escapeHtml(addressLabel(entry.publicKeyX))}</span>` : ""}
                      ${entry.nostrPublicKey ? `<span class="hint">Secure coordination ready</span>` : ""}
                    </div>
                    ${copyButton(addressText(entry.address), `Copy ${entry.label}`)}
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
