/** Network selection and advanced endpoint views. */

import { escapeHtml } from "@mc-wallet/core/html";
import type { Strk20NetworkConfig } from "@mc-wallet/privacy/config";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { button } from "@mc-wallet/ui-kit/controls";
import { textField } from "@mc-wallet/ui-kit/fields";
import { isStarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { flowHeader, flowScreen, walletMenuRow } from "../../shared/parts";
import { strk20ServicesForm } from "../privacy/privacy-settings-view";

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
 * Renders the primary network picker.
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
 * Renders the security-sensitive custom service endpoint editor.
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
