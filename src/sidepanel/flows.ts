/**
 * Dedicated flow screens. Each opens from a dock screen, focuses on one goal
 * — send, receive, switch network, switch account, manage addresses — and
 * returns through its back control, so journeys never blur into the home
 * screen.
 */
import type { ConnectedSite, TokenBalance, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { knownAccountType } from "../starknet/account-types";
import type { AllowanceView } from "../starknet/allowance-discovery";
import type { ClassHashVerification } from "../starknet/class-hash-verify";
import { isStarknetNetworkId } from "../starknet/networks";
import type { MultisigRecord } from "../storage/multisig-store";
import type { DisplayCurrency, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { receipt } from "../ui/content";
import { button } from "../ui/controls";
import { textareaField, textField } from "../ui/fields";
import { menuRow } from "../ui/navigation";
import { allowancesFlow } from "./allowance-views";
import { accountGroupsLine } from "./group-controls";
import { groupsSection } from "./group-members";
import { icon } from "./icons";
import { multisigAccountOptions } from "./multisig-account-options";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  noAccountEmpty,
  type WalletView,
  walletMenuRow,
} from "./parts";
import { receiveAddressView } from "./receive-view";
import { sendFlow } from "./send-views";
import {
  appearanceFlow,
  backupExportFlow,
  backupRestoreFlow,
  requestSettingsFlow,
  securityFlow,
} from "./settings-views";
import { addressBookFlow, connectedSitesFlow } from "./support-flows";
import { swapFlow } from "./swap-views";

export { sendFlow } from "./send-views";
export { backupHubFlow as backupFlow } from "./settings-views";
export { addressBookFlow, connectedSitesFlow } from "./support-flows";

/**
 * Receive flow: show and copy the active account address.
 */
export const receiveFlow = (status: WalletStatus, account: AccountRef | null): string =>
  flowHeader("Receive", status) +
  flowScreen(
    "receive",
    `<section class="section">
      ${
        account
          ? receiveAddressView({
              address: account.address,
              copyLabel: "Copy address",
              eyebrow: "Your address",
              hint: `Only send ${status.network} assets to this address.`,
            })
          : noAccountEmpty(status)
      }
      <p id="receive-result" role="status"></p>
    </section>`,
  );

/**
 * Renders raw-key import as a dedicated security-sensitive task reached from
 * the Add account chooser.
 */
export const importKeyFlow = (status: WalletStatus): string =>
  flowHeader("Import private key", status, `Add a standalone account on ${status.network}`) +
  flowScreen(
    "import-key",
    `<section class="section">
      <p class="review-flag" role="note">Anyone with this key controls the account. Paste it only on a device you trust.</p>
      <form id="import-key-form" class="stack">
        ${textareaField({
          autocomplete: "off",
          hint: "The key is validated and stored inside the encrypted vault, never in plain settings.",
          label: "Raw Starknet private key",
          name: "rawKey",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${button({
          icon: "wallet",
          label: "Import account",
          type: "submit",
        })}
        <p id="import-key-result" role="status"></p>
      </form>
    </section>`,
  );

const rpcOverrideFor = (status: WalletStatus, preferences: WalletPreferences | null): string =>
  preferences && isStarknetNetworkId(status.networkId)
    ? (preferences.rpcOverrides?.[status.networkId] ?? "")
    : "";

const strk20ProverUrlFor = (preferences: WalletPreferences | null): string =>
  preferences?.strk20ProverUrl ?? "";

const nftIndexerUrlFor = (preferences: WalletPreferences | null): string =>
  preferences?.nftIndexerUrl ?? "";

// One collapsed advanced-endpoint editor: a scannable summary row (name +
// configured/default state) that opens into the form. Keeps the network
// screen's primary task — picking a network — front and centre, with expert
// plumbing one deliberate tap deeper.
const endpointDisclosure = (
  id: string,
  title: string,
  state: string,
  body: string,
): string => `<details class="disclosure" data-disclosure="${escapeHtml(id)}">
    <summary>
      <span class="menu-copy"><strong>${escapeHtml(title)}</strong></span>
      <span class="menu-value">${escapeHtml(state)}</span>
      <span class="disclosure-mark">${icon("chevronRight")}</span>
    </summary>
    <div class="disclosure-body">${body}</div>
  </details>`;

/**
 * Network flow: choose the active network without mixing infrastructure edits
 * into the same task. Advanced endpoints are a deliberate second screen.
 */
export const networkFlow = (status: WalletStatus, preferences: WalletPreferences | null): string =>
  flowHeader("Network", status, "Choose where the wallet operates") +
  flowScreen(
    "network",
    `<section class="section">
      <div class="option-list" role="group" aria-label="Networks">
        ${status.networks
          .map(
            (
              network,
            ) => `<button class="option-row" data-network-id="${escapeHtml(network.id)}" type="button" aria-pressed="${network.id === status.networkId}">
              <span class="option-copy">
                <strong>${escapeHtml(network.name)}</strong>
                <code>${escapeHtml(network.id)}</code>
              </span>
              ${network.id === status.networkId ? `<span class="option-mark">${icon("check")}</span>` : ""}
            </button>`,
          )
          .join("")}
      </div>
      <p class="hint">Switching selects or derives an account on the target network.</p>
      <p id="picker-result" role="status"></p>
    </section>
    <section class="section">
      <div class="menu-list">
        ${walletMenuRow(
          "advanced-network",
          "Advanced endpoints",
          "settings",
          rpcOverrideFor(status, preferences) ? "Custom RPC" : "Defaults",
        )}
      </div>
    </section>`,
  );

/**
 * Renders expert RPC, prover, and NFT-indexer endpoints away from the primary
 * network picker. Every field preserves its existing privileged binding.
 */
export const advancedNetworkFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string =>
  flowHeader("Advanced endpoints", status, "Only change infrastructure you trust") +
  flowScreen(
    "advanced-network",
    `<section class="section">
      <p class="review-flag" role="note">Custom endpoints can observe requests made through them. Leave a field empty to use the wallet default or keep that integration off.</p>
      <div class="disclosure-stack">
        ${endpointDisclosure(
          "rpc",
          "RPC endpoint",
          rpcOverrideFor(status, preferences) ? "Custom" : "Default",
          `<form id="rpc-form">
            ${textField({
              autocomplete: "off",
              className: "mono",
              hint: "Used as the default when set. Leave empty to use the built-in endpoint.",
              label: `Custom endpoint for ${status.network}`,
              name: "rpcUrl",
              placeholder: "https://…",
              spellcheck: false,
              type: "url",
              value: rpcOverrideFor(status, preferences),
            })}
            ${button({
              icon: "check",
              label: "Save endpoint",
              type: "submit",
              variant: "secondary",
            })}
            <p id="rpc-result" role="status"></p>
          </form>`,
        )}
        ${endpointDisclosure(
          "strk20-prover",
          "STRK20 prover",
          strk20ProverUrlFor(preferences) ? "Configured" : "Off",
          `<form id="strk20-prover-form">
            ${textField({
              autocomplete: "off",
              className: "mono",
              hint: "Where the wallet requests STRK20 proofs. Leave empty to keep privacy features off.",
              label: "Privacy prover endpoint",
              name: "proverUrl",
              placeholder: "https://…",
              spellcheck: false,
              type: "url",
              value: strk20ProverUrlFor(preferences),
            })}
            ${button({
              icon: "check",
              label: "Save prover",
              type: "submit",
              variant: "secondary",
            })}
            <p id="strk20-prover-result" role="status"></p>
          </form>`,
        )}
        ${endpointDisclosure(
          "nft-indexer",
          "NFT indexer",
          nftIndexerUrlFor(preferences) ? "Configured" : "Off",
          `<form id="nft-indexer-form">
            ${textField({
              autocomplete: "off",
              className: "mono",
              hint: "Where the wallet lists NFTs an account owns. Ownership is re-checked on-chain. Leave empty to only show manually watched NFTs.",
              label: "NFT discovery endpoint",
              name: "indexerUrl",
              placeholder: "https://…",
              spellcheck: false,
              type: "url",
              value: nftIndexerUrlFor(preferences),
            })}
            ${button({
              icon: "check",
              label: "Save indexer",
              type: "submit",
              variant: "secondary",
            })}
            <p id="nft-indexer-result" role="status"></p>
          </form>`,
        )}
      </div>
    </section>`,
  );

/**
 * Renders the on-chain class-hash verification state shown beneath the account's
 * class hash. `null` is the still-loading state (kept visually distinct from a
 * confirmed result); a `mismatch` is a security signal and is surfaced as an
 * assertive alert. Only an exact on-chain match reads as verified.
 */
export const classHashVerificationBadge = (verification: ClassHashVerification | null): string => {
  if (verification === null) {
    return `<p class="verify-status pending" role="status">${icon("refresh")}Verifying on-chain…</p>`;
  }
  switch (verification.status) {
    case "verified":
      return `<p class="verify-status verified" role="status">${icon("shield")}Verified on-chain</p>`;
    case "mismatch":
      return `<p class="verify-status mismatch" role="alert">${icon("alert")}On-chain mismatch — the contract deployed at this address runs class <code>${escapeHtml(verification.onChainClassHash)}</code>, not the class shown above. Do not trust this account until resolved.</p>`;
    case "undeployed":
      return `<p class="verify-status pending" role="status">${icon("alert")}Not deployed yet — the class hash cannot be verified on-chain until this account is deployed.</p>`;
    case "unreachable":
      return `<p class="verify-status pending" role="status">${icon("alert")}Could not reach the network — shown from local data and not yet verified on-chain.</p>`;
  }
};

/**
 * Manage accounts & groups flow: the single management surface reached from the
 * drawer's "Manage accounts & groups" entry and the Settings menu. Switch the
 * active account, add one, manage groups (create/rename/change-icon/delete plus
 * bulk assignment) in the Groups accordion, name the account, and inspect
 * identifiers. `expandedGroupId` selects the one open Groups panel — a group's
 * bulk members editor or the "Create a group" panel (null = all collapsed).
 */
export const accountFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  expandedGroupId: string | null = null,
  classHashVerification: ClassHashVerification | null = null,
  multisigs: readonly MultisigRecord[] = [],
  selectedMultisigId: string | null = null,
): string => {
  const networkAccounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  const networkMultisigs = multisigs.filter((stored) => stored.networkId === status.networkId);
  const accountType = account ? knownAccountType(account.classHash) : null;
  const groups = preferences?.groups ?? [];
  // One grouped picker owns the whole "which account" task: every account row,
  // then "Add account" as the group's terminal action — not a separate boxed
  // section. The active account's editable name and its identifiers follow as
  // one receipt, truncated with copy controls, so the screen reads top to
  // bottom: pick → organise → inspect.
  return (
    flowHeader("Accounts & groups", status, `On ${status.network}`) +
    flowScreen(
      "account",
      `<section class="section">
        <p class="eyebrow">Accounts</p>
        <div class="option-list" role="group" aria-label="Accounts">
          ${networkAccounts
            .map((stored) => {
              const memberGroups = groups.filter((group) => group.accountIds.includes(stored.id));
              const selected = selectedMultisigId === null && stored.id === account?.id;
              return `<button class="option-row" data-account-id="${escapeHtml(stored.id)}" type="button" aria-pressed="${selected}">
                    <span class="option-avatar">${accountAvatar(stored.address)}</span>
                    <span class="option-copy">
                      <strong>${escapeHtml(accountDisplayName(stored, preferences))}</strong>
                      <code>${accountLabel(stored.address)}</code>
                      ${accountGroupsLine(memberGroups)}
                    </span>
                    ${selected ? `<span class="option-mark">${icon("check")}</span>` : ""}
                  </button>`;
            })
            .join("")}
          ${multisigAccountOptions(networkMultisigs, selectedMultisigId)}
          ${menuRow({
            attributes: {
              id: "new-account",
              title: `Derives the next account on ${status.network} from this wallet's recovery phrase.`,
            },
            className: "row-action",
            icon: "plus",
            label: "Add account",
          })}
        </div>
        ${networkAccounts.length === 0 && networkMultisigs.length === 0 ? noAccountEmpty(status) : ""}
        <p id="picker-result" role="status"></p>
        <p id="new-account-result" role="status"></p>
      </section>
      ${groupsSection(groups, status.accounts, preferences, expandedGroupId, status.networks)}
      ${
        account
          ? `<section class="section">
              <p class="eyebrow">${selectedMultisigId === null ? "Active account" : "Current signer"}</p>
              <form id="label-form">
                ${textField({
                  autocomplete: "off",
                  hint: "Shown instead of the address. Leave empty to clear.",
                  label: "Name",
                  maxlength: 64,
                  name: "label",
                  placeholder: accountLabel(account.address),
                  value: preferences?.accountLabels?.[account.id] ?? "",
                })}
                ${button({
                  icon: "check",
                  label: "Save name",
                  type: "submit",
                  variant: "secondary",
                })}
                <p id="label-result" role="status"></p>
              </form>
              ${receipt([
                {
                  action: {
                    attributes: { "data-copy": account.address },
                    icon: "copy",
                    label: "Copy address",
                  },
                  label: "Address",
                  value: accountLabel(account.address),
                  valueStyle: "code",
                },
                {
                  action: {
                    attributes: { "data-copy": account.classHash },
                    icon: "copy",
                    label: "Copy class hash",
                  },
                  label: "Class hash",
                  value: accountLabel(account.classHash),
                  valueStyle: "code",
                },
                ...(accountType ? [{ label: "Type", value: accountType }] : []),
              ])}
              ${classHashVerificationBadge(classHashVerification)}
            </section>`
          : ""
      }`,
    )
  );
};

/**
 * Renders the flow screens that need only the common context bag, split out of
 * views.ts dashboard() so its branch count stays within the complexity gate.
 * Returns null for views this module does not own.
 */
export const simpleFlowScreen = (
  activeView: WalletView,
  ctx: {
    readonly account: AccountRef | null;
    readonly allowances: readonly AllowanceView[];
    readonly balances: readonly TokenBalance[];
    readonly changes: Readonly<Record<string, number>>;
    readonly classHashVerification: ClassHashVerification | null;
    readonly connectedSites: readonly ConnectedSite[];
    readonly currency: DisplayCurrency;
    readonly expandedGroupId: string | null;
    readonly multisigs?: readonly MultisigRecord[];
    readonly selectedMultisigId?: string | null;
    readonly preferences: WalletPreferences | null;
    readonly prices: Readonly<Record<string, number>>;
    readonly status: WalletStatus;
  },
): string | null => {
  switch (activeView) {
    case "send":
      return sendFlow(
        ctx.status,
        ctx.account,
        ctx.preferences,
        ctx.balances,
        ctx.prices,
        ctx.changes,
        ctx.currency,
        ctx.multisigs ?? [],
      );
    case "swap":
      return swapFlow(ctx.status, ctx.account);
    case "receive":
      return receiveFlow(ctx.status, ctx.account);
    case "network":
      return networkFlow(ctx.status, ctx.preferences);
    case "advanced-network":
      return advancedNetworkFlow(ctx.status, ctx.preferences);
    case "account":
      return accountFlow(
        ctx.status,
        ctx.account,
        ctx.preferences,
        ctx.expandedGroupId,
        ctx.classHashVerification,
        ctx.multisigs,
        ctx.selectedMultisigId,
      );
    case "import-key":
      return importKeyFlow(ctx.status);
    case "address-book":
      return addressBookFlow(ctx.status, ctx.preferences);
    case "connected-sites":
      return connectedSitesFlow(ctx.status, ctx.connectedSites);
    case "allowances":
      return allowancesFlow(ctx.status, ctx.account, ctx.allowances);
    case "appearance":
      return appearanceFlow(ctx.status, ctx.preferences);
    case "request-settings":
      return requestSettingsFlow(ctx.status, ctx.preferences);
    case "security":
      return securityFlow(ctx.status);
    case "backup-export":
      return backupExportFlow(ctx.status);
    case "backup-restore":
      return backupRestoreFlow(ctx.status);
    default:
      return null;
  }
};
