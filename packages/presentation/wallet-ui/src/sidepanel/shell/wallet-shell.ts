/**
 * Shared unlocked-wallet chrome: account header, primary dock, pending-request
 * notice, action tiles, and undeployed-account notice.
 */

import { escapeHtml } from "@bramble/core/html";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { BRAMBLE_MARK } from "@bramble/ui-kit/brand-mark";
import { callout } from "@bramble/ui-kit/content";
import { iconButton, iconLink } from "@bramble/ui-kit/controls";
import { dockNavigation } from "@bramble/ui-kit/navigation";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { explorerAccountUrl } from "@bramble/wallet-model/networks";
import { PRIVACY_OTHER_WALLET } from "@bramble/wallet-protocol/privacy-blocker";
import type { WalletStatus } from "../../popup/responses/responses";
import { type IconName, icon } from "../shared/icons";
import { networkDisplayName } from "../shared/network-label";
import { accountAvatar, accountDisplayName, type WalletView } from "../shared/parts";

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
  // Opens the identity this header is showing, not the explorer's front page:
  // that account view is the only thing wanted from here, and Home no longer
  // carries an explorer tile. Null on devnet or before an account exists, which
  // renders a disabled control rather than a link that cannot resolve.
  const explorerUrl = address
    ? explorerAccountUrl(multisig?.networkId ?? status.networkId, address)
    : null;
  const network = networkDisplayName(status.network);
  const networkDetail = networkIssue
    ? `<span id="network-status-detail" class="sr-only">${escapeHtml(networkIssue)}</span>`
    : "";
  return `
  <header class="wallet-header">
    <button id="account-trigger" class="account-trigger" type="button" aria-haspopup="dialog" aria-expanded="false"${networkIssue ? ' aria-describedby="network-status-detail"' : ""} title="Manage accounts">
      <span class="brand-mark">${address ? accountAvatar(address) : BRAMBLE_MARK}</span>
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
      ${
        explorerUrl === null
          ? iconButton({
              attributes: { id: "starkscan-button" },
              disabled: true,
              icon: "externalLink",
              label: "Explorer unavailable on this network",
              variant: "ghost",
            })
          : iconLink({
              attributes: { id: "starkscan-button" },
              href: explorerUrl,
              icon: "externalLink",
              label: "View this account on the block explorer",
              target: "_blank",
              variant: "ghost",
            })
      }
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
 * Renders the home action that shields public value into the private pool.
 *
 * Emits the same attributes the token-detail surface uses, so the existing
 * privacy bindings pick it up with no wiring of its own: `data-send-shield`
 * opens Send in its Shield mode once privacy is ready, and `data-privacy-open`
 * starts activation when it is not — and when activation cannot proceed either
 * (no STRK for the fee, undeployed account, pending registration, no pool on
 * this network), that binding lands on the privacy screen with the reason and
 * the next step, so the tile is never a dead click. Disabled only when there is
 * no token to name — no account, or a network with none tracked — following the
 * explorer tile in staying put rather than reflowing the row.
 */
export const shieldTile = (
  tokenId: string | null,
  ready: boolean,
  deployment: boolean | null = null,
  fundedForFees: boolean | null = true,
  readOnly = false,
  otherWallet = false,
): string => {
  const needsDeploy = deployment === false;
  const needsFunds = needsDeploy && fundedForFees === false;
  const body = `<span class="tile-icon">${icon("shield")}</span>
      <span class="tile-label">Shield</span>`;
  // Another wallet registered this account. The tile still opens the privacy
  // screen, which states why shield and unshield are off, and does not offer
  // to activate.
  if (otherWallet && tokenId !== null) {
    return `<button class="action-tile" data-privacy-open="${escapeHtml(tokenId)}" type="button" aria-label="${escapeHtml(PRIVACY_OTHER_WALLET)}">${body}</button>`;
  }
  // A read-only account cannot sign the activation or the shield, so the tile
  // is a true disabled control, not a link into a flow that fails at the end.
  if (readOnly) {
    return `<button class="action-tile" type="button" disabled aria-label="Shield unavailable — this account is read only">${body}</button>`;
  }
  if (tokenId === null) {
    return `<button class="action-tile" type="button" disabled aria-label="Shield unavailable until a token is tracked">${body}</button>`;
  }
  // One tile, one word, whatever the account still needs: deployment and
  // funding are steps on the way to shielding, and the privacy screen this
  // opens names whichever one is in the way. The accessible name carries that
  // reason, so a screen reader is told before the tap rather than after.
  const attribute = ready && !needsDeploy ? "data-send-shield" : "data-privacy-open";
  const label = needsFunds
    ? "Shield — add STRK to this account first"
    : needsDeploy
      ? "Shield — deploy this account first"
      : ready
        ? "Shield public value into your private balance"
        : "Activate private balances";
  return `<button class="action-tile" ${attribute}="${escapeHtml(tokenId)}" type="button" aria-label="${label}">${body}</button>`;
};
