/** Focused side-panel task screens opened from the wallet dock. */

import { escapeHtml } from "@bramble/core/html";
import { withDefaultGroups } from "@bramble/settings/groups";
import type { DisplayCurrency, WalletPreferences } from "@bramble/settings/preferences";
import type { ClassHashVerification } from "@bramble/starknet/class-hash-verify";
import { receipt } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { selectField, textareaField, textField } from "@bramble/ui-kit/fields";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@bramble/wallet-model/networks";
import { t, th } from "../../../i18n/messages";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type {
  AllowanceListing,
  TokenBalance,
  WalletStatus,
} from "../../../popup/responses/responses";
import { addressFinderFields } from "../../journeys/onboarding/address-finder-view";
import { recoveryScanFields, recoveryWordInputs } from "../../journeys/onboarding/onboarding-views";
import { allowancesFlow } from "../../journeys/portfolio/allowance-views";
import type { PrivacyDisclosureState } from "../../journeys/privacy/privacy-model";
import { shadowAccountsFlow } from "../../journeys/privacy/shadow-accounts-view";
import {
  type PoolNoticeAction,
  privacyPoolNotice,
  receiveAddressView,
} from "../../journeys/send/receive-view";
import { FIRST_SEND_DEPLOYS } from "../../journeys/send/transfer-review-markup";
import { accountNamesSection, hiddenAccountsSection } from "../../journeys/settings/account-names";
import { groupsSection } from "../../journeys/settings/group-members";
import {
  accountDisplayName,
  accountLabel,
  flowHeader,
  flowScreen,
  noAccountEmpty,
  type WalletView,
} from "../../shared/parts";

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
import { languageFlow } from "../../journeys/settings/language-ui";
import { advancedNetworkFlow, networkFlow } from "../../journeys/settings/network-views";
import { privacyUnlockFlow } from "../../journeys/settings/privacy-unlock";
import {
  appearanceFlow,
  backupExportFlow,
  backupRestoreFlow,
  requestSettingsFlow,
} from "../../journeys/settings/settings-views";
import {
  STAKING_LOADING,
  type StakingState,
} from "../../journeys/staking/staking-directory-client";
import { stakingFlow } from "../../journeys/staking/staking-views";
import { swapFlow } from "../../journeys/swap/swap-views";
import { networkDisplayName } from "../../shared/network-label";
import { outcomeReceiptSection } from "../../shared/outcome-receipt";
import { deployNeedsStrk } from "../../shell/deploy-errors";
import { addressBookFlow, type ConnectedSitesState, connectedSitesFlow } from "./support-flows";

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
  flowHeader(t("shell.receive.title"), status) +
  flowScreen(
    "receive",
    `<section class="section">
      ${
        account
          ? receiveAddressView({
              address: account.address,
              classHash: account.classHash,
              classHashVerification,
              copyLabel: t("shell.copyAddress"),
              hint: t("shell.receive.hint", { network: status.network }),
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
 * The deploy screen's notes for an account that is not deployed (issue 662).
 * A balance read that found no STRK says so before the press rather than after
 * a node rejection; an unread balance (`null`) says nothing. An account whose
 * first send deploys it is told deploying here is optional; an undeployed
 * Braavos account is refused on a first send, so it is not.
 */
const deployNotes = (
  account: AccountRef,
  deployment: boolean | null,
  fundedForFees: boolean | null,
): string => {
  if (deployment !== false) return "";
  const notes = [
    ...(fundedForFees === false ? [deployNeedsStrk()] : []),
    ...(account.accountContractType === "braavos" ? [] : [FIRST_SEND_DEPLOYS]),
  ];
  return notes.map((note) => `<p class="hint">${escapeHtml(note)}</p>`).join("");
};

/**
 * Account deployment follows the same review and receipt model as other
 * fee-paying transactions instead of expanding controls into Home.
 */
const deployAccountFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  preferences: WalletPreferences | null,
  deployment: boolean | null,
  fundedForFees: boolean | null,
): string =>
  flowHeader(t("shell.deploy.title"), status) +
  flowScreen(
    "deploy-account",
    `<section class="section">
      ${
        account
          ? `<section class="section" id="deploy-review-stage">
              ${receipt([
                {
                  label: t("shell.field.account"),
                  value: accountDisplayName(account, preferences),
                },
                {
                  action: {
                    attributes: { "data-copy": account.address },
                    icon: "copy",
                    label: t("shell.copyAddress"),
                  },
                  label: t("shell.field.address"),
                  value: accountLabel(account.address),
                  valueStyle: "code",
                },
                { label: t("shell.field.network"), value: networkDisplayName(status.network) },
              ])}
              ${deployNotes(account, deployment, fundedForFees)}
              <div id="deploy-review" aria-live="polite"></div>
              ${button({
                attributes: { id: "deploy-button" },
                disabled: deployment !== false,
                icon: "check",
                label: t(deployment === true ? "shell.deploy.already" : "shell.deploy.button"),
              })}
              <p id="deploy-result" role="status"></p>
            </section>
            ${outcomeReceiptSection("deploy-success")}`
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
  flowHeader(
    t("shell.importPhrase.title"),
    status,
    t("shell.importPhrase.subtitle", { network: status.network }),
  ) +
  flowScreen(
    "import-phrase",
    `<section class="section">
      <p class="review-flag" role="note">${th("shell.importPhrase.warning")}</p>
      <form id="import-phrase-form" class="stack" novalidate>
        <div class="recovery-grid" data-recovery-grid="import">${recoveryWordInputs("import")}</div>
        <div class="recovery-actions">
          <button class="onboarding-inline-action" id="phrase-length-toggle" type="button">${th("onboarding.phrase.use24")}</button>
          <button class="onboarding-inline-action" id="phrase-clear" type="button">${th("onboarding.phrase.clear")}</button>
        </div>
        <p id="recovery-result" role="status"></p>
        ${button({
          attributes: { id: "import-phrase-search" },
          disabled: true,
          label: t("shell.importPhrase.find"),
        })}
        <div id="import-phrase-scan" hidden>
${recoveryScanFields()}
          ${button({
            attributes: { id: "recover-accounts-button" },
            disabled: true,
            label: t("shell.importPhrase.import"),
          })}
        </div>
      </form>
    </section>`,
  );

/**
 * Renders the rescan of this wallet's own accounts, reached from the add-account
 * chooser. Reuses the shared grouped scan; there is nothing to type on this
 * screen, because the background reads the phrase the wallet already holds.
 */
export const findAccountsFlow = (status: WalletStatus): string =>
  flowHeader(
    t("shell.findAccounts.title"),
    status,
    t("shell.findAccounts.subtitle", { network: status.network }),
  ) +
  flowScreen(
    "find-accounts",
    `<section class="section">
      <p class="review-flag" role="note">${th("shell.findAccounts.scope")}</p>
      <form id="find-accounts-form" class="stack" novalidate>
        <p class="hint">${th("shell.findAccounts.hint")}</p>
        ${button({ attributes: { id: "find-accounts-search" }, label: t("shell.findAccounts.search") })}
        <div id="find-accounts-scan" hidden>
${recoveryScanFields()}
          ${button({
            attributes: { id: "recover-accounts-button" },
            disabled: true,
            label: t("shell.findAccounts.add"),
          })}
        </div>
        <p id="find-accounts-result" role="status"></p>
      </form>
    </section>`,
  );

/**
 * Renders raw-key import as a dedicated security-sensitive task reached from
 * the Add account chooser.
 */
export const importKeyFlow = (status: WalletStatus): string =>
  flowHeader(
    t("shell.importKey.title"),
    status,
    t("shell.importKey.subtitle", { network: status.network }),
  ) +
  flowScreen(
    "import-key",
    `<section class="section">
      <p class="review-flag" role="note">${th("shell.importKey.warning")}</p>
      <form id="import-key-form" class="stack">
        ${selectField({
          hint: t("shell.importKey.contractHint"),
          label: t("shell.importKey.contract"),
          name: "accountContractType",
          options: [
            { label: t("shell.importKey.recommended"), value: "openzeppelin" },
            { label: "Ready", value: "argent" },
          ],
          selected: "openzeppelin",
        })}
        ${textareaField({
          autocomplete: "off",
          hint: t("shell.importKey.keyHint"),
          label: t("shell.importKey.key"),
          name: "rawKey",
          placeholder: "0x…",
          required: true,
          spellcheck: false,
        })}
        ${textField({
          autocomplete: "off",
          hint: t("shell.importKey.saltHint"),
          label: t("shell.importKey.salt"),
          name: "deploymentSalt",
          placeholder: "0x…",
          spellcheck: false,
        })}
        ${addressFinderFields("key", { hidden: true })}
        ${button({
          icon: "wallet",
          label: t("shell.importKey.submit"),
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
    flowHeader(t("shell.accounts.title"), status) +
    flowScreen(
      "account",
      accountNamesSection(status, preferences, groups) +
        hiddenAccountsSection(status, preferences) +
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
    readonly allowances: AllowanceListing;
    readonly staking?: StakingState;
    readonly balances: readonly TokenBalance[];
    readonly changes: Readonly<Record<string, number>>;
    readonly classHashVerification: ClassHashVerification | null;
    readonly connectedSites: ConnectedSitesState;
    readonly currency: DisplayCurrency;
    readonly deployment: boolean | null;
    readonly expandedGroupId: string | null;
    /** Whether a successful balance read found STRK; `null` when unread. */
    readonly fundedForFees?: boolean | null;
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
      return deployAccountFlow(
        ctx.status,
        ctx.account,
        ctx.preferences,
        ctx.deployment,
        ctx.fundedForFees ?? null,
      );
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
    case "find-accounts":
      return findAccountsFlow(ctx.status);
    case "address-book":
      return addressBookFlow(ctx.status, ctx.preferences);
    case "connected-sites":
      return connectedSitesFlow(ctx.status, ctx.connectedSites);
    case "staking":
      return stakingFlow(ctx.status, ctx.account, ctx.staking ?? STAKING_LOADING);
    case "allowances":
      return allowancesFlow(ctx.status, ctx.account, ctx.allowances, ctx.preferences);
    case "shadow-accounts":
      return shadowAccountsFlow(ctx.status);
    case "appearance":
      return appearanceFlow(ctx.status, ctx.preferences);
    case "language":
      return languageFlow(ctx.status, ctx.preferences);
    case "request-settings":
      return requestSettingsFlow(ctx.status, ctx.preferences);
    case "privacy-unlock":
      return privacyUnlockFlow(ctx.status);
    case "backup-export":
      return backupExportFlow(ctx.status);
    case "backup-restore":
      return backupRestoreFlow(ctx.status);
    default:
      return null;
  }
};
