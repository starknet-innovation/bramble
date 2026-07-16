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
  "swap",
  "receive",
  "network",
  "account",
  "address-book",
  "backup",
  "connected-sites",
  "tokens",
  "token-detail",
  "allowances",
  "multisigs",
  "multisig-detail",
  "multisig-propose",
  "multisig-deploy",
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
 * Renders a flat, single-colour avatar chip for an address: one solid fill from
 * a small per-account palette (cobalt / teal / amber / violet) with a quiet
 * person glyph, matching the Clean Mono comp. The tone is chosen
 * deterministically from the address, so an account always keeps the same
 * colour. Fill and glyph ink come from the `--mc-avatar-*` tokens (see
 * ./styles-base) — no gradients, no raw colour literals — and the chip's
 * rounded-square shape and hairline are carried by its container
 * (`.brand-mark` / `.option-avatar`).
 */
export const accountAvatar = (address: string): string => {
  let bits: bigint;
  try {
    bits = BigInt(address);
  } catch {
    bits = 0n;
  }
  const tone = Number(bits % 4n);
  return `<svg class="avatar" viewBox="0 0 40 40" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <rect width="40" height="40" fill="var(--mc-avatar-${tone})" />
    <circle cx="20" cy="15.5" r="6" fill="var(--mc-avatar-ink)" opacity="0.9" />
    <path d="M8 34c1.7-7 6.4-10.5 12-10.5S30.3 27 32 34" fill="var(--mc-avatar-ink)" opacity="0.9" />
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
const networkPill = (status: WalletStatus): string =>
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
 * title, and the network context. The back control carries no static target —
 * it pops the navigation history (see ./nav-history.ts), so Back always returns
 * to the screen the user actually came from regardless of how this one was
 * reached.
 */
export const flowHeader = (title: string, status: WalletStatus, subtitle?: string): string => `
  <header class="flow-header">
    <button class="icon-button ghost" data-nav-back type="button" aria-label="Back" title="Back">${icon("chevronLeft")}</button>
    <div class="flow-title">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
    </div>
    ${networkPill(status)}
  </header>`;
