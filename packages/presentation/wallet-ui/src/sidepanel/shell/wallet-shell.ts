/**
 * Shared unlocked-wallet chrome: account header, primary dock, pending-request
 * notice, action tiles, and undeployed-account notice.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { MultisigRecord } from "@mc-wallet/multisig/repository";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { callout } from "@mc-wallet/ui-kit/content";
import { button, iconButton, iconLink } from "@mc-wallet/ui-kit/controls";
import { dockNavigation } from "@mc-wallet/ui-kit/navigation";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { WalletStatus } from "../../popup/responses/responses";
import { type IconName, icon } from "../shared/icons";
import { accountAvatar, accountDisplayName, type WalletView } from "../shared/parts";
import { TERMINAL_URL } from "./terminal-link";

/**
 * Renders the unlocked account header and its trusted destinations.
 */
export const walletHeader = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  multisig: MultisigRecord | null = null,
): string => {
  const name = multisig
    ? (multisig.name ?? "Multisig account")
    : account
      ? accountDisplayName(account, preferences)
      : "MC Wallet";
  const address = multisig?.address ?? account?.address;
  const network = status.network
    .replace(/^Starknet Mainnet$/, "Starknet")
    .replace(/^Starknet\s+/, "");
  return `
  <header class="wallet-header">
    <button id="account-trigger" class="account-trigger" type="button" aria-haspopup="dialog" aria-expanded="false" title="Manage accounts">
      <span class="brand-mark">${address ? accountAvatar(address) : icon("wallet")}</span>
      <span class="account-meta">
        <span class="account-name"><strong>${escapeHtml(name)}</strong>${icon("chevronDown")}</span>
        <span class="account-net"><span class="dot"></span>${escapeHtml(network)}${multisig ? ` · Multisig ${multisig.quorum} of ${multisig.signers.length}` : ""}</span>
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
        attributes: { id: "terminal-button" },
        href: TERMINAL_URL,
        icon: "terminal",
        label: "Open trade terminal",
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
 * Renders the counterfactual-account deployment action when chain state is
 * conclusively undeployed. Deployment is a fee-paying transaction, so the action
 * stays disabled — with the reason on hover — until the account holds STRK to
 * pay with. Offering it to an empty account only produces a failed estimate.
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
            id: "deploy-button",
            title: fundedForFees
              ? "This account contract is not on-chain yet. Deploying it enables transactions."
              : "Deploying costs a network fee. Receive STRK into this account first.",
          },
          className: "deploy-chip",
          disabled: !fundedForFees,
          icon: "alert",
          label: fundedForFees ? "Not deployed — deploy now" : "Not deployed — receive STRK first",
          size: "small",
          variant: "secondary",
        })}
        <p id="deploy-result" role="status"></p>
      </div>`;
