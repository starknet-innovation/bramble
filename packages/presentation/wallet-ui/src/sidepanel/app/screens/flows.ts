/** Focused side-panel task screens opened from the wallet dock. */

import { escapeHtml } from "@mc-wallet/core/html";
import type { DisplayCurrency, WalletPreferences } from "@mc-wallet/settings/preferences";
import type { ClassHashVerification } from "@mc-wallet/starknet/class-hash-verify";
import type { AllowanceView } from "@mc-wallet/transactions/allowance-discovery";
import { receipt } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { selectField, textareaField, textField } from "@mc-wallet/ui-kit/fields";
import { menuRow } from "@mc-wallet/ui-kit/navigation";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { ConnectedSite, TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import { multisigAccountOptions } from "../../journeys/multisig/multisig-account-options";
import { allowancesFlow } from "../../journeys/portfolio/allowance-views";
import type { PrivacyDisclosureState } from "../../journeys/privacy/privacy-model";
import {
  type PoolNoticeAction,
  privacyPoolNotice,
  receiveAddressView,
} from "../../journeys/send/receive-view";
import { accountGroupsLine } from "../../journeys/settings/group-controls";
import { groupsSection } from "../../journeys/settings/group-members";
import { icon } from "../../shared/icons";
import {
  accountAvatar,
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  noAccountEmpty,
  type WalletView,
} from "../../shared/parts";
import { knownAccountType } from "../../shell/account-types";

// Fees use STRK and registration invokes a deployed account. Deployment blocks
// only on a conclusive `false`, so a fresh read does not flicker into the form.
const poolNoticeAction = (ctx: {
  readonly balances: readonly TokenBalance[];
  readonly deployment: boolean | null;
}): PoolNoticeAction => {
  const funded = ctx.balances.some(
    (token) => sameFelt(token.address, STRK_TOKEN_ADDRESS) && BigInt(token.balance) > 0n,
  );
  if (!funded) {
    return "fund-first";
  }
  return ctx.deployment === false ? "deploy-first" : "register";
};

import type { SendIntent } from "../../journeys/send/send-model";
import { sendFlow } from "../../journeys/send/send-views";
import { advancedNetworkFlow, networkFlow } from "../../journeys/settings/network-views";
import {
  appearanceFlow,
  backupExportFlow,
  backupRestoreFlow,
  requestSettingsFlow,
  securityFlow,
} from "../../journeys/settings/settings-views";
import { swapFlow } from "../../journeys/swap/swap-views";
import { addressBookFlow, connectedSitesFlow } from "./support-flows";

export { sendFlow } from "../../journeys/send/send-views";
export { backupHubFlow as backupFlow } from "../../journeys/settings/settings-views";

/**
 * Receive flow: show and copy the active account address.
 */
const receiveFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  privacy: PrivacyDisclosureState,
  poolAction: PoolNoticeAction,
): string =>
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
      ${account ? privacyPoolNotice(privacy, poolAction) : ""}
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
        ${selectField({
          hint: "Choose the contract that already owns this key. A different choice derives a different address.",
          label: "Account contract",
          name: "accountContractType",
          options: [
            { label: "OpenZeppelin Account — Recommended", value: "openzeppelin" },
            { label: "Argent Account", value: "argent" },
          ],
          selected: "openzeppelin",
        })}
        ${textareaField({
          autocomplete: "off",
          hint: "The key is validated and stored inside the encrypted vault, never in plain settings.",
          label: "Raw Starknet private key",
          name: "rawKey",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${textField({
          autocomplete: "off",
          hint: "Argent only. Enter the original DEPLOY_ACCOUNT salt to recover an externally created account; leave blank for MC Wallet's public-key salt.",
          label: "Argent deployment salt (optional)",
          name: "deploymentSalt",
          placeholder: "0x…",
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
  multisigs: readonly ArgentMultisigView[] = [],
  selectedMultisigId: string | null = null,
): string => {
  const networkAccounts = status.accounts.filter((stored) => stored.networkId === status.networkId);
  const networkMultisigs = multisigs.filter(
    (stored) => stored.record.networkId === status.networkId,
  );
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
                      <span class="option-name"><strong>${escapeHtml(accountDisplayName(stored, preferences))}</strong>${accountGroupsLine(memberGroups)}</span>
                      <code>${accountLabel(stored.address)}</code>
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
                    attributes: { "data-copy": account.publicKeyX },
                    icon: "copy",
                    label: "Copy signer public key",
                  },
                  label: "Signer public key",
                  value: accountLabel(account.publicKeyX),
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
    readonly deployment: boolean | null;
    readonly expandedGroupId: string | null;
    readonly multisigs?: readonly ArgentMultisigView[];
    readonly selectedMultisigId?: string | null;
    readonly preferences: WalletPreferences | null;
    readonly prices: Readonly<Record<string, number>>;
    readonly privacy: PrivacyDisclosureState;
    readonly sendIntent?: SendIntent | null;
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
        (ctx.multisigs ?? []).map((view) => view.record),
        ctx.sendIntent ?? null,
      );
    case "swap":
      return swapFlow(ctx.status, ctx.account);
    case "receive":
      return receiveFlow(ctx.status, ctx.account, ctx.privacy, poolNoticeAction(ctx));
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
