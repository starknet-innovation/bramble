/**
 * Network selection and the advanced-endpoints settings screen: which
 * infrastructure the wallet talks to on the active network, and which third
 * party is allowed to see the account address.
 *
 * Read-only: submitting a field sends a privileged extension message through
 * `./endpoint-ui.ts`, and every rendered state comes from the preferences the
 * background returned. No value here is written directly to storage.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import type { Strk20NetworkConfig } from "@mc-wallet/privacy/config";
import { explorerFallbackAllowed, type WalletPreferences } from "@mc-wallet/settings/preferences";
import { button } from "@mc-wallet/ui-kit/controls";
import { checkboxField, textField } from "@mc-wallet/ui-kit/fields";
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

// Resolved, not stored: an untouched network shows the default this user gets
// (on for built-in endpoints, off once they configured their own RPC), so the
// checkbox never claims a decision the user has not made. Preferences that
// failed to load render as off — the same fail-closed answer the background
// gives — rather than as a permission the user cannot see the basis for.
const explorerFallbackFor = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): boolean =>
  preferences !== null &&
  isStarknetNetworkId(status.networkId) &&
  explorerFallbackAllowed(preferences, status.networkId);

const explorerFallbackForm = (status: WalletStatus, allowed: boolean): string =>
  `<form id="explorer-fallback-form">
    <p class="hint">If every endpoint above fails, the wallet can ask a public block explorer for balances and history on ${escapeHtml(status.network)}. The explorer then learns which addresses you hold, and its numbers cannot be verified against the chain. Leave this off to see an error instead.</p>
    ${checkboxField({
      checked: allowed,
      name: "explorerFallback",
      text: "Allow a public explorer when my endpoints are unreachable",
    })}
    ${button({
      icon: "check",
      label: "Save fallback choice",
      type: "submit",
      variant: "secondary",
    })}
    <p id="explorer-fallback-result" role="status"></p>
  </form>`;

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
 * Renders the security-sensitive custom service endpoint editor: expert RPC,
 * prover, NFT-indexer, and explorer-fallback settings, away from the primary
 * network picker. Read-only — every field submits a privileged message and the
 * rendered state always comes from the preferences the background returned.
 */
export const advancedNetworkFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string => {
  const privacy = strk20ConfigFor(status, preferences);
  const explorerAllowed = explorerFallbackFor(status, preferences);
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
          "explorer-fallback",
          "Explorer fallback",
          explorerAllowed ? "Allowed" : "Off",
          explorerFallbackForm(status, explorerAllowed),
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
