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
  "connected-sites",
  "tokens",
  "token-detail",
  "allowances",
  "nfts",
  "nft-detail",
  "reveal",
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
export const friendlyAccountName = (address: string): string => {
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
 * Renders a deterministic gradient identicon for an address: a diagonal
 * two-tone gradient with a soft accent orb, all hues derived from the address,
 * filling its circular container. Distinct and recognizable per account without
 * the sparse, glyph-like look of a pixel grid.
 */
export const accountAvatar = (address: string): string => {
  let bits: bigint;
  try {
    bits = BigInt(address);
  } catch {
    bits = 0n;
  }
  const pick = (shift: number, mod: number): number =>
    Number((bits >> BigInt(shift)) % BigInt(mod));
  const h1 = pick(0, 360);
  const h2 = (h1 + 55 + pick(11, 120)) % 360;
  const h3 = (h1 + 190 + pick(23, 120)) % 360;
  const orbX = 9 + pick(31, 22);
  const orbY = 8 + pick(43, 18);
  // A per-address gradient id; identical for repeats of the same account, so any
  // duplicate reference resolves to the same definition.
  const id = `av-${(bits % 2147483647n).toString(36)}`;
  return `<svg class="avatar" viewBox="0 0 40 40" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${h1} 74% 62%)" />
        <stop offset="1" stop-color="hsl(${h2} 66% 44%)" />
      </linearGradient>
    </defs>
    <rect width="40" height="40" fill="url(#${id})" />
    <circle cx="${orbX}" cy="${orbY}" r="11" fill="hsl(${h3} 85% 66%)" opacity="0.55" />
  </svg>`;
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
    <button class="icon-button ghost" data-view="${backView}" type="button" aria-label="Back" title="Back">${icon("chevronLeft")}</button>
    <div class="flow-title">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
    </div>
    ${networkPill(status)}
  </header>`;
