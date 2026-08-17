/**
 * Shared side panel template atoms used by dock and flow screens.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { shortAddress } from "@mc-wallet/transactions/verify-decode";
import { emptyState, pill } from "@mc-wallet/ui-kit/content";
import { iconButton } from "@mc-wallet/ui-kit/controls";
import { type IconName, icon } from "@mc-wallet/ui-kit/icons";
import { menuRow } from "@mc-wallet/ui-kit/navigation";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import type { WalletStatus } from "../../popup/responses/responses";

export { accountAvatar } from "../shell/account-avatar";

/**
 * Side panel screen ids. The first three live on the bottom dock; the rest
 * are dedicated flow screens reached from a dock screen.
 */
export const WALLET_VIEWS = [
  "home",
  "activity",
  "settings",
  "send",
  "swap",
  "receive",
  "network",
  "advanced-network",
  "account",
  "import-key",
  "address-book",
  "backup",
  "backup-export",
  "backup-restore",
  "connected-sites",
  "appearance",
  "request-settings",
  "security",
  "requests",
  "tokens",
  "token-add",
  "token-discover",
  "token-detail",
  "privacy",
  "allowances",
  "multisigs",
  "multisig-add",
  "multisig-watch",
  "multisig-home",
  "multisig-detail",
  "multisig-signers",
  "multisig-track",
  "multisig-receive",
  "multisig-propose",
  "multisig-deploy",
  "nfts",
  "nft-watch",
  "nft-hidden",
  "nft-detail",
  "nft-send",
  "reveal",
] as const;

/**
 * Current side panel screen.
 */
export type WalletView = (typeof WALLET_VIEWS)[number];

const WALLET_VIEW_LABELS: Readonly<Record<WalletView, string>> = {
  account: "Accounts",
  activity: "Activity",
  "address-book": "Address book",
  allowances: "Token allowances",
  "advanced-network": "Network services",
  appearance: "Appearance",
  backup: "Backup and restore",
  "backup-export": "Backup export",
  "backup-restore": "Backup restore",
  "connected-sites": "Connected sites",
  home: "Home",
  "import-key": "Private-key import",
  multisigs: "Multisig accounts",
  "multisig-add": "Add multisig",
  "multisig-deploy": "Deploy multisig",
  "multisig-detail": "Multisig transaction",
  "multisig-home": "Multisig portfolio",
  "multisig-propose": "Prepare multisig transaction",
  "multisig-receive": "Multisig receive",
  "multisig-signers": "Multisig signers",
  "multisig-track": "Track multisig transaction",
  "multisig-watch": "Watch multisig",
  network: "Networks",
  nfts: "Collectibles",
  "nft-detail": "Collectible details",
  "nft-hidden": "Hidden collectibles",
  "nft-send": "Send collectible",
  "nft-watch": "Watch collectible",
  privacy: "Private balances",
  receive: "Receive",
  requests: "Wallet requests",
  "request-settings": "Request display",
  reveal: "Recovery secrets",
  security: "Security and permissions",
  send: "Send",
  settings: "Settings",
  swap: "Swap",
  tokens: "Tokens",
  "token-add": "Add token",
  "token-detail": "Token details",
  "token-discover": "Discover tokens",
};

/**
 * Returns the stable human label used when a task is paused or resumed. This
 * mapping is presentation-only; navigation still validates against
 * {@link WALLET_VIEWS}.
 */
export const walletViewLabel = (view: WalletView): string => WALLET_VIEW_LABELS[view];

/**
 * Dock screens shown with the bottom navigation.
 */
export const DOCK_VIEWS: readonly WalletView[] = ["home", "activity", "settings"];

/**
 * Checks untrusted dataset values before changing screens.
 */
export const isWalletView = (value: unknown): value is WalletView =>
  typeof value === "string" && WALLET_VIEWS.some((view) => view === value);

/**
 * Truncates a Starknet address for display.
 */
export const accountLabel = (address: string): string => shortAddress(address);

/**
 * Renders a native, repaint-persistent explanation for protocol concepts. The
 * copy is escaped and stays collapsed until requested, keeping expert detail
 * available without making it part of the primary decision plane.
 */
export const contextHelp = (id: string, title: string, body: string): string =>
  `<details class="disclosure context-help" data-disclosure="${escapeHtml(id)}">
    <summary>
      <span class="menu-copy"><strong>${escapeHtml(title)}</strong></span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body"><p>${escapeHtml(body)}</p></div>
  </details>`;

const NAME_ADJECTIVES = [
  "Amber",
  "Bold",
  "Brave",
  "Bright",
  "Calm",
  "Clever",
  "Cosmic",
  "Eager",
  "Gentle",
  "Golden",
  "Happy",
  "Keen",
  "Lively",
  "Loyal",
  "Lucky",
  "Mighty",
  "Noble",
  "Quiet",
  "Rapid",
  "Royal",
  "Sunny",
  "Swift",
  "Vivid",
  "Witty",
  "Zesty",
  "Steady",
  "Choppy",
  "Learned",
  "Masterful",
  "Chief",
] as const;
const NAME_ANIMALS = [
  "Otter",
  "Falcon",
  "Lynx",
  "Heron",
  "Bison",
  "Marten",
  "Osprey",
  "Panda",
  "Raven",
  "Sable",
  "Tapir",
  "Viper",
  "Walrus",
  "Yak",
  "Zebra",
  "Badger",
  "Cobra",
  "Dingo",
  "Egret",
  "Ferret",
  "Gecko",
  "Ibis",
  "Jackal",
  "Koala",
  "Ladybird",
  "Snail",
  "Chilli",
  "Lobster",
  "Mouse",
  "Cheese",
] as const;

/**
 * Deterministic two-word account nickname (adjective + animal) derived from the
 * address, so an account without a user label still reads as a friendly name
 * rather than a raw hex string.
 */
const friendlyAccountName = (address: string): string => {
  let bits: bigint;
  try {
    bits = BigInt(address);
  } catch {
    bits = 0n;
  }
  const adjective = NAME_ADJECTIVES[Number(bits % BigInt(NAME_ADJECTIVES.length))] ?? "Amber";
  const animal = NAME_ANIMALS[Number((bits / 131n) % BigInt(NAME_ANIMALS.length))] ?? "Otter";
  return `${adjective} ${animal}`;
};

/**
 * Resolves the user-chosen display name for an account, falling back to a
 * deterministic friendly nickname derived from the address.
 */
export const accountDisplayName = (
  account: AccountRef,
  preferences: WalletPreferences | null,
): string => preferences?.accountLabels?.[account.id] ?? friendlyAccountName(account.address);

/**
 * Resolves the active account for the current network.
 */
export const activeAccount = (status: WalletStatus): AccountRef | null =>
  status.accounts.find(
    (account) => account.id === status.activeAccountId && account.networkId === status.networkId,
  ) ??
  status.accounts.find((account) => account.networkId === status.networkId) ??
  null;

/**
 * Renders network options for the onboarding network select.
 */
export const networkOptions = (status: WalletStatus): string =>
  status.networks
    .map(
      (network) =>
        `<option value="${escapeHtml(network.id)}" ${network.id === status.networkId ? "selected" : ""}>${escapeHtml(network.name)}</option>`,
    )
    .join("");

/**
 * Formats a FRI (10^-18 STRK) fee amount as a short STRK string.
 */
export const formatFri = (fri: string): string => {
  let raw: bigint;
  try {
    raw = BigInt(fri);
  } catch {
    return fri;
  }
  const base = 10n ** 18n;
  const whole = raw / base;
  const fraction = ((raw % base) + base).toString().slice(1, 7).replace(/0+$/, "");
  return fraction.length === 0 ? `${whole} STRK` : `${whole}.${fraction} STRK`;
};

/**
 * Renders the hardware-wallet badge for a Ledger account, or an empty string for
 * any other account kind. Keyed off the account's `derivation.kind`, so the badge
 * is a total function of provenance — a software account can never render it.
 */
export const hardwareBadge = (account: AccountRef): string =>
  account.derivation.kind === "ledger"
    ? pill("Hardware", { icon: "shield", tone: "hardware" })
    : "";

/**
 * Renders an icon button that copies a value to the clipboard.
 */
export const copyButton = (value: string, label: string): string =>
  iconButton({
    attributes: { "data-copy": value },
    icon: "copy",
    label,
  });

/**
 * Renders the network status pill.
 */
const networkPill = (status: WalletStatus): string => pill(status.network, { dot: true });

/**
 * Renders the shared empty state for networks without an account.
 */
export const noAccountEmpty = (status: WalletStatus): string =>
  emptyState(`No account on ${status.network} yet. Switch network from Settings to continue.`);

/**
 * Renders one settings destination with the side-panel navigation capability.
 */
export const walletMenuRow = (
  view: WalletView,
  label: string,
  name: IconName,
  value?: string,
): string =>
  menuRow({
    attributes: { "data-view": view },
    icon: name,
    label,
    ...(value ? { value } : {}),
  });

/**
 * Wraps dock screen content in its tab panel container.
 */
export const dockScreen = (view: WalletView, body: string): string =>
  `<main class="screen" id="wallet-screen-${view}" role="tabpanel" tabindex="-1">${body}</main>`;

/**
 * Wraps flow screen content in a focused, dock-free container.
 */
export const flowScreen = (view: WalletView, body: string): string =>
  `<main class="screen flow" id="wallet-screen-${view}" tabindex="-1">${body}</main>`;

/**
 * Renders the header every flow screen starts with: a back control, the goal
 * title, and the network context. The back control carries no static target —
 * it pops the navigation history (see ./nav-history.ts), so Back always returns
 * to the screen the user actually came from regardless of how this one was
 * reached.
 */
export const flowHeader = (title: string, status: WalletStatus, subtitle?: string): string => `
  <header class="flow-header">
    ${iconButton({
      attributes: { "data-nav-back": true },
      icon: "chevronLeft",
      label: "Back",
      variant: "ghost",
    })}
    <div class="flow-title">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
    </div>
    ${networkPill(status)}
  </header>`;
