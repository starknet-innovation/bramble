/**
 * Shared side panel template atoms used by dock and flow screens.
 */

import { escapeHtml } from "@bramble/core/html";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { shortAddress } from "@bramble/transactions/verify-decode";
import { emptyState, pill } from "@bramble/ui-kit/content";
import { iconButton } from "@bramble/ui-kit/controls";
import type { UiAttributes } from "@bramble/ui-kit/html-attributes";
import { type IconName, icon } from "@bramble/ui-kit/icons";
import { menuRow } from "@bramble/ui-kit/navigation";
import type { AccountContractType, AccountRef } from "@bramble/wallet-model/accounts";
import type { WalletStatus } from "../../popup/responses/responses";
import { networkDisplayName } from "./network-label";

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
  "deploy-account",
  "network",
  "advanced-network",
  "account",
  "import-key",
  "import-phrase",
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
  "token-catalog",
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

/**
 * Valid gallery routes withheld while the collectibles journey is parked.
 * Navigation rejects these before it can alter screen history or start data
 * hydration; the journey modules remain available for a deliberate restore.
 */
export const PARKED_COLLECTIBLE_VIEWS = [
  "nfts",
  "nft-watch",
  "nft-hidden",
  "nft-detail",
  "nft-send",
] as const satisfies readonly WalletView[];

/**
 * Returns whether a valid screen route is deliberately unavailable while the
 * collectibles journey is parked.
 */
export const isParkedCollectibleView = (view: WalletView): boolean =>
  PARKED_COLLECTIBLE_VIEWS.some((parked) => parked === view);

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
  "deploy-account": "Deploy account",
  home: "Home",
  "import-key": "Private-key import",
  "import-phrase": "Recovery-phrase import",
  multisigs: "Multisig accounts",
  "multisig-add": "Set up multisig",
  "multisig-deploy": "Create a multisig account",
  "multisig-detail": "Review multisig transaction",
  "multisig-home": "Multisig account",
  "multisig-propose": "New multisig transaction",
  "multisig-receive": "Receive to multisig",
  "multisig-signers": "Manage multisig signers",
  "multisig-track": "Import signing intent",
  "multisig-watch": "Add multisig account",
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
  "token-catalog": "avnu token list",
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
 * The address half of a `<network>:<address>` account id, for surfaces that
 * receive only the id (approval context, Ledger signing) yet must show and copy
 * the account address. An id without a separator passes through whole.
 */
export const accountIdAddress = (accountId: string): string =>
  accountId.slice(accountId.indexOf(":") + 1);

/**
 * Count text for an account-group disclosure: how many active (deployed or
 * funded) accounts the scan found in that family. Plain text (callers own the
 * markup, and whether a zero is worth showing) shared by the recovery-phrase
 * and Ledger import pickers so the two flows describe detection identically.
 */
export const accountsDetectedText = (detected: number): string => `${detected} found`;

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
 * rather than a raw hex string. Exported so a rename field can show the name an
 * account falls back to when its label is empty — the same string
 * {@link accountDisplayName} resolves to — instead of inventing a second
 * fallback. Presentational only: it never identifies an account.
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

const ACCOUNT_FAMILY_NAMES: Readonly<Record<AccountContractType, string>> = {
  argent: "Ready",
  braavos: "Braavos",
  openzeppelin: "Bramble",
};

/**
 * The wallet an account's contract family comes from, for the short label shown
 * beside an account. Keyed on every family, so a new one cannot silently borrow
 * another's name. Presentational only.
 */
export const accountFamilyName = (accountContractType: AccountContractType): string =>
  ACCOUNT_FAMILY_NAMES[accountContractType];

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
 * Renders the quiet copy control that trails a truncated identifier inline — a
 * list row's address, a review fact, an activity counterparty, a signer key.
 * Ghost, and sized like a receipt row's copy action (`.copy-inline`), so every
 * inline copy affordance reads the same. Copies `value` in full; the visible
 * text stays the caller's truncated label. `attributes` lets a surface that
 * repaints the identifier in place (Send's chosen recipient) address and hide
 * the control until it has a value.
 */
export const inlineCopyButton = (
  value: string,
  label: string,
  attributes: UiAttributes = {},
): string =>
  iconButton({
    attributes: { ...attributes, "data-copy": value },
    className: "copy-inline",
    icon: "copy",
    label,
    variant: "ghost",
  });

/**
 * Renders a flow's step rail: one numbered item per label, the first active.
 * The caller names the attribute its own binding reads, so two journeys share
 * one rail rather than each growing a copy of the markup. Each step carries its
 * own name, which is the binding's own vocabulary and not derived from the
 * label — a rail whose labels change must not move the hooks under it.
 */
export const flowSteps = (
  attribute: string,
  ariaLabel: string,
  steps: readonly (readonly [name: string, label: string])[],
): string =>
  `<ol class="send-progress" aria-label="${escapeHtml(ariaLabel)}" hidden>
    ${steps
      .map(
        ([name, label], index) =>
          `<li ${attribute}="${escapeHtml(name)}" data-state="${index === 0 ? "active" : "pending"}">
      <span class="send-step-mark">${index + 1}</span><span>${escapeHtml(label)}</span>
    </li>`,
      )
      .join("")}
  </ol>`;

/**
 * Marks one step of a rail active, everything before it done, everything after
 * pending. Shared by every journey that shows a rail.
 */
export const setFlowStep = (root: ParentNode, attribute: string, activeIndex: number): void => {
  root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((step, index) => {
    const current = step;
    current.dataset["state"] =
      index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
    current.toggleAttribute("aria-current", index === activeIndex);
  });
};

/**
 * Renders the network status pill.
 */
const networkPill = (status: WalletStatus): string =>
  pill(networkDisplayName(status.network), { dot: true });

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
 * Wraps trusted wallet-renderer markup in its dock tab panel. Callers must
 * escape every dynamic value before composing `trustedMarkup`; raw provider,
 * dapp, or user text is never accepted here.
 */
export const dockScreen = (view: WalletView, trustedMarkup: string): string =>
  `<main class="screen" id="wallet-screen-${escapeHtml(view)}" role="tabpanel" tabindex="-1">${trustedMarkup}</main>`;

/**
 * Wraps trusted wallet-renderer markup in a focused, dock-free container.
 * Callers must escape every dynamic value before composing `trustedMarkup`.
 */
export const flowScreen = (view: WalletView, trustedMarkup: string): string =>
  `<main class="screen flow" id="wallet-screen-${escapeHtml(view)}" tabindex="-1">${trustedMarkup}</main>`;

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
