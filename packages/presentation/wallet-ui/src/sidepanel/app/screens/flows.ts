/** Focused side-panel task screens opened from the wallet dock. */

import type { MultisigRecord } from "@mc-wallet/multisig/repository";
import type { DisplayCurrency, WalletPreferences } from "@mc-wallet/settings/preferences";
import type { ClassHashVerification } from "@mc-wallet/starknet/class-hash-verify";
import type { AllowanceView } from "@mc-wallet/transactions/allowance-discovery";
import { button } from "@mc-wallet/ui-kit/controls";
import { textareaField } from "@mc-wallet/ui-kit/fields";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STRK_TOKEN_ADDRESS, sameFelt } from "@mc-wallet/wallet-model/networks";
import type { ConnectedSite, TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import { allowancesFlow } from "../../journeys/portfolio/allowance-views";
import type { PrivacyDisclosureState } from "../../journeys/privacy/privacy-model";
import {
  type PoolNoticeAction,
  privacyPoolNotice,
  receiveAddressView,
} from "../../journeys/send/receive-view";
import { flowHeader, flowScreen, noAccountEmpty, type WalletView } from "../../shared/parts";
import { accountFlow } from "./account-flow";

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
export { accountFlow, classHashVerificationBadge } from "./account-flow";
export { addressBookFlow, connectedSitesFlow } from "./support-flows";

/**
 * Receive flow: show and copy the active account address.
 */
export const receiveFlow = (
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
    readonly multisigs?: readonly MultisigRecord[];
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
        ctx.multisigs ?? [],
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
