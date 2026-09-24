/**
 * Left slide-in account drawer opened from the header avatar. Kept lean: it
 * lists this network's single-signer and multisig accounts with identicons and
 * names, grouped under the folder each belongs to, marks the selected one,
 * offers "Add account", and links to the dedicated "Manage accounts & folders"
 * view. Accounts move between folders by dragging, and a folder is created
 * inline at the bottom; the rest of group management (rename, change icon,
 * delete, bulk assignment) lives on the manage view, not here. No per-row
 * address copy either: each row is the switch control, its `<code>` reveals the
 * full address on hover, and the full, copyable identifiers live one tap away
 * on that same manage view. Pure template — open/close state and bindings live
 * in ./home-ui.ts and ./drawer-folders-ui.ts, styles in ./styles-home.ts.
 * Rendered closed on every dock screen; the runtime restores the open state
 * (collapsed folders, the open create field) across re-renders without
 * replaying the slide.
 */

import { escapeHtml } from "@bramble/core/html";
import { withDefaultGroups } from "@bramble/settings/groups";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { emptyState, pill } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { menuRow } from "@bramble/ui-kit/navigation";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { ArgentMultisigView } from "../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../popup/responses/responses";
import { icon } from "../shared/icons";
import { networkDisplayName } from "../shared/network-label";
import { accountAvatar, accountDisplayName, accountLabel, hardwareBadge } from "../shared/parts";
import {
  addFolderControl,
  folderSection,
  folderSections,
  INITIAL_COLLAPSED_FOLDERS,
} from "./drawer-folders";

const drawerMultisigRow = (
  view: ArgentMultisigView,
  open: number,
  selectedId: string | null,
): string => {
  const { record } = view;
  return `<li class="drawer-account-item">
    <button class="drawer-account drawer-multisig" data-multisig-select="${escapeHtml(record.id)}" type="button" aria-pressed="${record.id === selectedId}">
      <span class="option-avatar">${accountAvatar(record.address)}</span>
      <span class="drawer-copy">
        <strong>${escapeHtml(record.name ?? "Multisig account")}</strong>
        <code title="${escapeHtml(record.address)}">${escapeHtml(accountLabel(record.address))}</code>
        <span class="account-groups-line">Ready Multisig · ${view.config ? `${view.config.threshold} of ${view.config.signerGuids.length}` : "authority unavailable"}${open > 0 ? ` · ${open} open` : ""}</span>
      </span>
      <span class="option-mark">${icon(record.id === selectedId ? "check" : "chevronRight")}</span>
    </button>
  </li>`;
};

const drawerAccountRow = (
  stored: AccountRef,
  activeId: string | null,
  singleSignerSelected: boolean,
  preferences: WalletPreferences | null,
  selectedMultisig: ArgentMultisigView | null,
): string => {
  const name = accountDisplayName(stored, preferences);
  const selectedMultisigSigner =
    selectedMultisig?.config?.signerGuids.includes(argentSignerGuid(stored.publicKeyX)) ?? false;
  return `
  <li class="drawer-account-item" draggable="true" data-drag-account="${escapeHtml(stored.id)}">
    <div class="drawer-account-row">
      <button class="drawer-account" data-switch-account="${escapeHtml(stored.id)}" data-active-signer="${stored.id === activeId}"${selectedMultisigSigner ? ' data-selected-multisig-signer="true"' : ""} type="button" aria-pressed="${singleSignerSelected && stored.id === activeId}">
        <span class="option-avatar">${accountAvatar(stored.address)}</span>
        <span class="drawer-copy">
          <strong>${escapeHtml(name)}${hardwareBadge(stored)}</strong>
          <code title="${escapeHtml(stored.address)}">${accountLabel(stored.address)}</code>
          ${selectedMultisigSigner ? `<span class="account-groups-line">Signer for ${escapeHtml(selectedMultisig?.record.name ?? "selected multisig")}</span>` : ""}
        </span>
        ${singleSignerSelected && stored.id === activeId ? `<span class="option-mark">${icon("check")}</span>` : ""}
      </button>
    </div>
  </li>`;
};

/**
 * The drawer's network pill, and the list it opens. The pill names the network
 * the wallet is on rather than the chain, since the chain is never the question
 * here. Switching is offered where the network is shown instead of only in
 * settings; the option ids are distinct from the settings picker's so the two
 * bindings never claim each other's buttons — that picker returns to settings
 * after a switch, which is wrong from inside the drawer.
 */
const networkControl = (status: WalletStatus): string => `
  <div class="drawer-network">
    <button class="drawer-network-pill" type="button" data-drawer-network-toggle
      aria-expanded="false" aria-haspopup="listbox" aria-controls="drawer-network-menu">
      ${pill(networkDisplayName(status.network), { dot: true })}${icon("chevronDown")}
    </button>
    <div class="drawer-network-menu" id="drawer-network-menu" role="listbox" aria-label="Network" hidden>
      ${status.networks
        .map(
          (network) => `<button class="drawer-network-option" type="button" role="option"
            data-drawer-network-id="${escapeHtml(network.id)}"
            aria-selected="${network.id === status.networkId}">
            <span>${escapeHtml(network.name)}</span>
            ${network.id === status.networkId ? icon("check") : ""}
          </button>`,
        )
        .join("")}
    </div>
  </div>`;

/**
 * Renders the account drawer and its backdrop, closed by default. The header
 * avatar trigger toggles `data-open`; backdrop, close control, and Escape all
 * dismiss it.
 *
 * Accounts are listed under the folder they belong to: the home folder first,
 * the user's own next, the archive last and collapsed. An account is moved by
 * dragging it onto another folder, and a folder is created inline at the
 * bottom. Renaming, re-iconing and deleting folders stay on "Manage accounts &
 * groups". `collapsedFolders` and `addFolderOpen` keep those two pieces of
 * drawer state across re-renders.
 */
export const accountDrawer = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  collapsedFolders: readonly string[] = INITIAL_COLLAPSED_FOLDERS,
  addFolderOpen = false,
  multisigs: readonly ArgentMultisigView[] = [],
  intents: readonly { readonly accountId: string; readonly state: string }[] = [],
  selectedMultisigId: string | null = null,
): string => {
  const groups = withDefaultGroups(preferences?.groups ?? []);
  const accounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  const shared = multisigs.filter((view) => view.record.networkId === status.networkId);
  const selectedMultisig = shared.find((view) => view.record.id === selectedMultisigId) ?? null;
  const sections = folderSections(groups, accounts);
  return `
  <div class="drawer-root" data-open="false">
    <div class="drawer-backdrop" data-drawer-close></div>
    <aside class="account-drawer" role="dialog" aria-modal="true" aria-label="Accounts">
      <header class="drawer-head">
        <div class="drawer-title">
          <h2>Accounts</h2>
          ${networkControl(status)}
        </div>
        ${iconButton({
          attributes: { "data-drawer-close": true },
          className: "drawer-close",
          icon: "x",
          label: "Close accounts",
          variant: "ghost",
        })}
      </header>
      ${
        accounts.length === 0 && shared.length === 0
          ? emptyState("No accounts on this network yet. Add one below.")
          : `<div class="drawer-folders">${sections
              .map((section) =>
                folderSection(
                  section,
                  section.accounts
                    .map((stored) =>
                      drawerAccountRow(
                        stored,
                        account?.id ?? null,
                        selectedMultisigId === null,
                        preferences,
                        selectedMultisig,
                      ),
                    )
                    .join(""),
                  collapsedFolders.includes(section.group.id),
                ),
              )
              .join("")}${addFolderControl(addFolderOpen)}${
              shared.length === 0
                ? ""
                : `<section class="drawer-folder drawer-shared">
                    <p class="eyebrow">Multisig accounts</p>
                    <ul class="drawer-list">${shared
                      .map((view) =>
                        drawerMultisigRow(
                          view,
                          intents.filter(
                            (intent) =>
                              intent.accountId === view.record.id &&
                              (intent.state === "collecting" || intent.state === "ready"),
                          ).length,
                          selectedMultisigId,
                        ),
                      )
                      .join("")}</ul>
                  </section>`
            }</div>`
      }
      <div class="drawer-foot">
        ${button({
          attributes: { id: "drawer-add-account" },
          icon: "plus",
          label: "Add account",
          variant: "secondary",
        })}
        ${menuRow({
          attributes: { "data-view": "account" },
          icon: "settings",
          label: "Manage accounts & folders",
        })}
      </div>
    </aside>
  </div>`;
};
