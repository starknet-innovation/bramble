/** Focused side-panel task screens opened from the wallet dock. */

import { withDefaultGroups } from "@bramble/settings/groups";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import type { AllowanceView } from "@bramble/transactions/allowance-discovery";
import { receipt } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { selectField, textareaField, textField } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { ConnectedSite, TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import { recoveryScanFields, recoveryWordInputs } from "../../journeys/onboarding/onboarding-views";
import { allowancesFlow } from "../../journeys/portfolio/allowance-views";
import type { PrivacyDisclosureState } from "../../journeys/privacy/privacy-model";
import {
  type PoolNoticeAction,
  privacyPoolNotice,
  receiveAddressView,
} from "../../journeys/send/receive-view";
import { accountNamesSection } from "../../journeys/settings/account-names";
import { groupsSection } from "../../journeys/settings/group-members";
import {
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  noAccountEmpty,
  type WalletView,
} from "../../shared/parts";
import { reviewOutcome, reviewPanel } from "../../shared/review-render";
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
import { networkDisplayName } from "../../shared/network-label";
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
  classHashVerification: ClassHashVerification | null,
): string =>
  flowHeader("Receive", status) +
  flowScreen(
    "receive",
    `<section class="section">
      ${
        account
          ? receiveAddressView({
              address: account.address,
              classHash: account.classHash,
              classHashVerification,
              copyLabel: "Copy address",
              hint: `Only send ${status.network} assets to this address.`,
              networkId: status.networkId,
              publicKeyX: account.publicKeyX,
            })
          : noAccountEmpty(status)
      }
      ${account ? privacyPoolNotice(privacy, poolAction) : ""}
      <p id="receive-result" role="status"></p>
    </section>`,
  );

/**
 * Account deployment follows the same review and receipt model as other
 * fee-paying transactions instead of expanding controls into Home.
 */
const deployAccountFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  deployment: boolean | null,
): string =>
  flowHeader(
    "Deploy account",
    status,
    account ? accountDisplayName(account, preferences) : undefined,
  ) +
  flowScreen(
    "deploy-account",
    `<section class="section">
      ${
        account
          ? `<section class="section" id="deploy-review-stage">
              ${reviewOutcome("Deploy this account contract on Starknet so it can submit transactions.")}
              ${receipt([
                { label: "Account", value: accountDisplayName(account, preferences) },
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
                  label: "Contract",
                  value: knownAccountType(account.classHash) ?? "Starknet account",
                },
                { label: "Network", value: networkDisplayName(status.network) },
              ])}
              ${reviewPanel([], "Deployment creates this account on-chain. Its address and signing authority do not change.")}
              <div id="deploy-review" aria-live="polite"></div>
              ${button({
                attributes: { id: "deploy-button" },
                disabled: deployment !== false,
                icon: "check",
                label: deployment === true ? "Account already deployed" : "Review deployment",
              })}
              <p id="deploy-result" role="status"></p>
            </section>
            <section class="send-outcome send-success" id="deploy-success" role="status" aria-live="polite" hidden>
              <span class="send-outcome-mark" aria-hidden="true">
                <svg viewBox="0 0 56 56"><circle class="send-success-ring" cx="28" cy="28" r="25" /><path class="send-success-check" d="M18 29.5l7 7 14-15" /></svg>
              </span>
              <div class="send-outcome-copy">
                <p class="send-outcome-kicker">Submitted to Starknet</p>
                <h2>Deployment submitted</h2>
                <p>Your account will be ready once Starknet confirms this transaction.</p>
                <code id="deploy-hash"></code>
              </div>
              ${button({ attributes: { "data-view": "home" }, icon: "home", label: "Back to home" })}
            </section>`
          : noAccountEmpty(status)
      }
    </section>`,
  );

/**
 * Renders the in-wallet recovery-phrase import: enter another wallet's phrase,
 * scan its indices with the shared grouped picker, and import the selected
 * accounts into the unlocked vault. The phrase lives only in its form fields
 * until the single privileged import request.
 */
export const importPhraseFlow = (status: WalletStatus): string =>
  flowHeader("Import a recovery phrase", status, `Add existing accounts on ${status.network}`) +
  flowScreen(
    "import-phrase",
    `<section class="section">
      <p class="review-flag" role="note">Anyone with this phrase controls its accounts. Type it only on a device you trust.</p>
      <form id="import-phrase-form" class="stack" novalidate>
        <div class="recovery-grid" data-recovery-grid="import">${recoveryWordInputs("import")}</div>
        <button class="onboarding-inline-action" id="phrase-length-toggle" type="button">Use a 24-word phrase</button>
        <p id="recovery-result" role="status"></p>
        ${button({
          attributes: { id: "import-phrase-search" },
          disabled: true,
          label: "Find its accounts",
        })}
        <div id="import-phrase-scan" hidden>
${recoveryScanFields("import the selected accounts")}
          ${button({
            attributes: { id: "recover-accounts-button" },
            disabled: true,
            label: "Import selected accounts",
          })}
        </div>
      </form>
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
            { label: "Bramble Account — Recommended", value: "openzeppelin" },
            { label: "Ready Account", value: "argent" },
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
          hint: "Ready accounts only. Enter the original DEPLOY_ACCOUNT salt to recover an externally created account; leave blank for Bramble's public-key salt.",
          label: "Ready deployment salt (optional)",
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
 * Manage accounts & folders flow: the single management surface reached from the
 * drawer's "Manage accounts & folders" entry and the Settings menu. Name every
 * account on this network, add one, and manage groups (create/rename/
 * change-icon/delete plus bulk assignment) in the Groups accordion.
 * `expandedGroupId` selects the one open Groups panel — a group's bulk members
 * editor or the "Create a folder" panel (null = all collapsed). Both default
 * folders are shown even when the wallet has never stored a group, matching the
 * drawer, so they can be renamed here.
 *
 * Switching accounts is the drawer's job and is not repeated here, and the
 * account's identifiers (address, signer public key, class hash) live on
 * Receive, which is the screen that exists to hand them out.
 */
export const accountFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  expandedGroupId: string | null = null,
): string => {
  const groups = withDefaultGroups(preferences?.groups ?? []);
  // The screen reads top to bottom: name the accounts, then file them. Both
  // halves read the same seeded folder list, so a wallet that has never stored
  // a group still shows "My accounts" and "Archived accounts" on both.
  return (
    flowHeader("Accounts & groups", status) +
    flowScreen(
      "account",
      accountNamesSection(status, preferences, groups) +
        groupsSection(groups, status.accounts, preferences, expandedGroupId, status.networks),
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
    readonly selectedTokenId?: string | null;
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
        ctx.selectedTokenId ?? null,
      );
    case "swap":
      return swapFlow(ctx.status, ctx.account);
    case "receive":
      return receiveFlow(
        ctx.status,
        ctx.account,
        ctx.privacy,
        poolNoticeAction(ctx),
        ctx.classHashVerification,
      );
    case "deploy-account":
      return deployAccountFlow(ctx.status, ctx.account, ctx.preferences, ctx.deployment);
    case "network":
      return networkFlow(ctx.status, ctx.preferences);
    case "advanced-network":
      return advancedNetworkFlow(ctx.status, ctx.preferences);
    case "account":
      return accountFlow(ctx.status, ctx.preferences, ctx.expandedGroupId);
    case "import-key":
      return importKeyFlow(ctx.status);
    case "import-phrase":
      return importPhraseFlow(ctx.status);
    case "address-book":
      return addressBookFlow(ctx.status, ctx.preferences);
    case "connected-sites":
      return connectedSitesFlow(ctx.status, ctx.connectedSites);
    case "allowances":
      return allowancesFlow(ctx.status, ctx.account, ctx.allowances, ctx.preferences);
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
