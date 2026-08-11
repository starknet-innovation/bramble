/**
 * Dedicated flow screens. Each opens from a dock screen, focuses on one goal
 * — send, receive, switch network, switch account, manage addresses — and
 * returns through its back control, so journeys never blur into the home
 * screen.
 */
import type { ConnectedSite, TokenBalance, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import type { AllowanceView } from "../starknet/allowance-discovery";
import type { ClassHashVerification } from "../starknet/class-hash-verify";
import { isStarknetNetworkId, STRK_TOKEN_ADDRESS, sameFelt } from "../starknet/networks";
import type { Strk20NetworkConfig } from "../starknet/strk20/config";
import type { MultisigRecord } from "../storage/multisig-store";
import type { DisplayCurrency, WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { button } from "../ui/controls";
import { textareaField, textField } from "../ui/fields";
import { accountFlow } from "./account-flow";
import { allowancesFlow } from "./allowance-views";
import { icon } from "./icons";
import { flowHeader, flowScreen, noAccountEmpty, type WalletView, walletMenuRow } from "./parts";
import type { PrivacyDisclosureState } from "./privacy-model";
import { strk20ServicesForm } from "./privacy-settings-view";
import { type PoolNoticeAction, privacyPoolNotice, receiveAddressView } from "./receive-view";

// Fees are paid in STRK, and registration is an invoke from a deployed account:
// with no STRK there is nothing to offer, and with STRK but no contract the
// deployment has to run first. Deployment is only blocking on a conclusive
// `false`, so a fresh read does not flicker into the static form.
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

import type { SendIntent } from "./send-model";
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

export { accountFlow, classHashVerificationBadge } from "./account-flow";
export { sendFlow } from "./send-views";
export { backupHubFlow as backupFlow } from "./settings-views";
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

const rpcOverrideFor = (status: WalletStatus, preferences: WalletPreferences | null): string =>
  preferences && isStarknetNetworkId(status.networkId)
    ? (preferences.rpcOverrides?.[status.networkId] ?? "")
    : "";

const strk20ConfigFor = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): Strk20NetworkConfig | null =>
  preferences && isStarknetNetworkId(status.networkId)
    ? (preferences.strk20Networks?.[status.networkId] ?? null)
    : null;

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
): string => {
  const privacy = strk20ConfigFor(status, preferences);
  return (
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
          "strk20-services",
          "STRK20 privacy services",
          privacy ? "Configured" : "Off",
          strk20ServicesForm(status.network, privacy),
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
