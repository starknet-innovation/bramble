/**
 * Shared side panel template atoms used by dock and flow screens.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { icon } from "./icons";

/**
 * Side panel screen ids. The first three live on the bottom dock; the rest
 * are dedicated flow screens reached from a dock screen.
 */
export const WALLET_VIEWS = [
  "home",
  "activity",
  "settings",
  "send",
  "receive",
  "network",
  "account",
  "address-book",
  "backup",
] as const;

/**
 * Current side panel screen.
 */
export type WalletView = (typeof WALLET_VIEWS)[number];

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
export const accountLabel = (address: string): string =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * Resolves the user-chosen display name for an account, falling back to the
 * truncated address.
 */
export const accountDisplayName = (
  account: AccountRef,
  preferences: WalletPreferences | null,
): string => preferences?.accountLabels?.[account.id] ?? accountLabel(account.address);

/**
 * Renders a deterministic identicon for an address: a symmetric 5x5 grid
 * derived from the address bits, drawn in the current skin color.
 */
export const accountAvatar = (address: string): string => {
  let bits: bigint;
  try {
    bits = BigInt(address);
  } catch {
    bits = 0n;
  }
  const cells: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const bit = (bits >> BigInt(row * 3 + col)) & 1n;
      if (bit === 1n) {
        cells.push(`<rect x="${col}" y="${row}" width="1" height="1" />`);
        if (col < 2) {
          cells.push(`<rect x="${4 - col}" y="${row}" width="1" height="1" />`);
        }
      }
    }
  }
  return `<svg class="avatar" viewBox="-0.5 -0.5 6 6" aria-hidden="true" fill="currentColor">${cells.join("")}</svg>`;
};

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
 * Renders an icon button that copies a value to the clipboard.
 */
export const copyButton = (value: string, label: string): string =>
  `<button class="icon-button" data-copy="${escapeHtml(value)}" type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon("copy")}</button>`;

/**
 * Renders the network status pill.
 */
export const networkPill = (status: WalletStatus): string =>
  `<span class="pill"><span class="dot"></span>${escapeHtml(status.network)}</span>`;

/**
 * Renders the shared empty state for networks without an account.
 */
export const noAccountEmpty = (status: WalletStatus): string =>
  `<p class="empty">No account on ${escapeHtml(status.network)} yet. Switch network from Settings to continue.</p>`;

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
 * title, and the network context.
 */
export const flowHeader = (
  title: string,
  backView: WalletView,
  status: WalletStatus,
  subtitle?: string,
): string => `
  <header class="flow-header">
    <button class="icon-button" data-view="${backView}" type="button" aria-label="Back" title="Back">${icon("chevronLeft")}</button>
    <div class="flow-title">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
    </div>
    ${networkPill(status)}
  </header>`;
