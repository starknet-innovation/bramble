/**
 * Shared unlocked-wallet chrome: account header, primary dock, pending-request
 * notice, action tiles, and undeployed-account notice.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { MultisigRecord } from "../storage/multisig-store";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { callout } from "../ui/content";
import { button, iconButton, iconLink } from "../ui/controls";
import { dockNavigation } from "../ui/navigation";
import { type IconName, icon } from "./icons";
import { accountAvatar, accountDisplayName, type WalletView } from "./parts";
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
 * Renders the trusted bridge from the compact wallet into MC Terminal.
 */
export const terminalCta = (): string =>
  `<a class="terminal-cta" href="${escapeHtml(TERMINAL_URL)}" target="_blank" rel="noopener noreferrer" aria-label="Join MC Terminal, your homebase for all Starknet activity">
    <span class="terminal-cta-icon">${icon("monitor")}</span>
    <span class="terminal-cta-copy"><strong>Join MC Terminal</strong><span>Your homebase for all Starknet activity</span></span>
    <span class="terminal-cta-arrow">${icon("chevronRight")}</span>
  </a>`;

/**
 * Renders the counterfactual-account deployment action when chain state is
 * conclusively undeployed.
 */
export const deployNotice = (account: AccountRef | null, deployment: boolean | null): string =>
  account === null || deployment !== false
    ? ""
    : `<div class="deploy-notice">
        ${button({
          attributes: {
            id: "deploy-button",
            title: "This account contract is not on-chain yet. Deploying it enables transactions.",
          },
          className: "deploy-chip",
          icon: "alert",
          label: "Not deployed — deploy now",
          size: "small",
          variant: "secondary",
        })}
        <p id="deploy-result" role="status"></p>
      </div>`;
