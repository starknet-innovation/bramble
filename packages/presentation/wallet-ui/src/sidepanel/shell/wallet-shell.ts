/**
 * Shared unlocked-wallet chrome: account header, primary dock, pending-request
 * notice, action tiles, and undeployed-account notice.
 */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { callout } from "@bramble/ui-kit/content";
import { button, iconButton, iconLink } from "@bramble/ui-kit/controls";
import { dockNavigation } from "@bramble/ui-kit/navigation";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../popup/responses/responses";
import { type IconName, icon } from "../shared/icons";
import { accountAvatar, accountDisplayName, type WalletView } from "../shared/parts";
import { STARKSCAN_URL } from "./starkscan-link";

/**
 * Renders the unlocked account header and its trusted destinations.
 */
export const walletHeader = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  multisig: ArgentMultisigRecord | null = null,
  networkIssue: string | null = null,
): string => {
  const name = multisig
    ? (multisig.name ?? "Multisig account")
    : account
      ? accountDisplayName(account, preferences)
      : "Bramble";
  const address = multisig?.address ?? account?.address;
  const network = status.network
    .replace(/^Starknet Mainnet$/, "Starknet")
    .replace(/^Starknet\s+/, "");
  const networkDetail = networkIssue
    ? `<span id="network-status-detail" class="sr-only">${escapeHtml(networkIssue)}</span>`
    : "";
  return `
  <header class="wallet-header">
    <button id="account-trigger" class="account-trigger" type="button" aria-haspopup="dialog" aria-expanded="false"${networkIssue ? ' aria-describedby="network-status-detail"' : ""} title="Manage accounts">
      <span class="brand-mark">${address ? accountAvatar(address) : icon("wallet")}</span>
      <span class="account-meta">
        <span class="account-name"><strong>${escapeHtml(name)}</strong>${icon("chevronDown")}</span>
        <span class="account-net${networkIssue ? " degraded" : ""}"${networkIssue ? ` title="${escapeHtml(networkIssue)}"` : ""}><span class="dot" aria-hidden="true"></span><span class="account-network-label">${escapeHtml(network)}</span>${networkDetail}</span>
      </span>
    </button>
    <div class="header-actions">
      ${iconButton({
        attributes: { "data-view": "connected-sites" },
        icon: "link",
        label: "Connected sites",
        variant: "ghost",
      })}
      ${iconLink({
        attributes: { id: "starkscan-button" },
        href: STARKSCAN_URL,
        icon: "externalLink",
        label: "Open Starkscan",
        target: "_blank",
        variant: "ghost",
      })}
      ${iconButton({
        attributes: { id: "lock-button" },
        icon: "lock",
        label: "Lock wallet",
        variant: "ghost",
      })}
    </div>
  </header>`;
};

/**
 * Renders the persistent three-destination wallet dock.
 */
export const walletDock = (
  activeView: WalletView,
  pendingCount: number,
  sharedAccount = false,
): string =>
  dockNavigation([
    {
      attributes: { "data-view": sharedAccount ? "multisig-home" : "home" },
      controls: "wallet-screen-home",
      icon: "home",
      label: "Home",
      selected: activeView === "home" || activeView === "multisig-home",
    },
    {
      attributes: { "data-view": "activity" },
      controls: "wallet-screen-activity",
      count: pendingCount,
      icon: "activity",
      label: "Activity",
      selected: activeView === "activity",
    },
    {
      attributes: { "data-view": "settings" },
      controls: "wallet-screen-settings",
      icon: "settings",
      label: "Settings",
      selected: activeView === "settings",
    },
  ]);

/**
 * Renders the actionable connection-request notice only when work is waiting.
 */
export const pendingCallout = (pendingCount: number): string =>
  pendingCount === 0
    ? ""
    : callout({
        action: {
          attributes: { "data-view": "activity" },
          label: "Review",
          size: "small",
          variant: "secondary",
        },
        body: "Review before any site can see your accounts.",
        icon: "link",
        title: `${pendingCount} connection ${pendingCount === 1 ? "request" : "requests"} waiting`,
      });

/**
 * Renders one task-oriented home action.
 */
export const actionTile = (
  view: WalletView,
  label: string,
  name: IconName,
  enabled: boolean,
): string =>
  `<button class="action-tile" data-view="${view}" type="button" ${enabled ? "" : "disabled"}>
    <span class="tile-icon">${icon(name)}</span>
    <span class="tile-label">${escapeHtml(label)}</span>
  </button>`;

/**
 * Renders the home action that opens the active account on the public block
 * explorer. Disabled rather than hidden when there is nothing to open — no
 * account yet, or a network without an explorer (devnet) — so the action row
 * keeps its shape instead of reflowing between screens.
 */
export const explorerTile = (url: string | null): string => {
  const body = `<span class="tile-icon">${icon("externalLink")}</span>
    <span class="tile-label">Explorer</span>`;
  return url === null
    ? `<button class="action-tile" type="button" disabled aria-label="Explorer unavailable on this network">${body}</button>`
    : `<a class="action-tile" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open this account on the block explorer">${body}</a>`;
};

/**
 * Renders the counterfactual-account status when chain state is conclusively
 * undeployed. Home only directs the user to the next task; fee review and
 * submission stay in their dedicated transaction journeys.
 */
export const deployNotice = (
  account: AccountRef | null,
  deployment: boolean | null,
  fundedForFees = true,
): string =>
  account === null || deployment !== false
    ? ""
    : `<div class="deploy-notice">
        ${button({
          attributes: {
            "data-view": fundedForFees ? "deploy-account" : "receive",
            title: fundedForFees
              ? "This account contract is not on-chain yet. Deploying it enables transactions."
              : "Deploying costs a network fee. Receive STRK into this account first.",
          },
          className: "deploy-chip",
          icon: "alert",
          label: fundedForFees ? "Deploy account" : "Fund with STRK",
          size: "small",
          variant: "secondary",
        })}
      </div>`;
