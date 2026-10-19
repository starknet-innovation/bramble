/**
 * Network selection and the advanced-endpoints settings screen: which
 * infrastructure the wallet talks to on the active network, and which third
 * party is allowed to see the account address.
 *
 * Read-only: submitting a field sends a privileged extension message through
 * `./endpoint-ui.ts`, and every rendered state comes from the preferences the
 * background returned. No value here is written directly to storage.
 */

import { escapeHtml } from "@bramble/core/html";
import type { Strk20NetworkConfig } from "@bramble/privacy/config";
import { explorerFallbackAllowed, type WalletPreferences } from "@bramble/settings/preferences";
import { button } from "@bramble/ui-kit/controls";
import { checkboxField, textField } from "@bramble/ui-kit/fields";
import { isStarknetNetworkId, STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import { contextHelp, flowHeader, flowScreen, walletMenuRow } from "../../shared/parts";
import { strk20ServicesForm } from "../privacy/privacy-settings-view";

const rpcOverrideFor = (status: WalletStatus, preferences: WalletPreferences | null): string =>
  preferences && isStarknetNetworkId(status.networkId)
    ? (preferences.rpcOverrides?.[status.networkId] ?? "")
    : "";

// Devnet is the one network the user hosts, so state what the wallet will dial
// and the chain id the write-path guard checks before a write fails on it.
const devnetHint = (status: WalletStatus, preferences: WalletPreferences | null): string => {
  if (status.networkId !== "SN_DEVNET") {
    return "";
  }
  const override = rpcOverrideFor(status, preferences);
  const endpoint = escapeHtml(override || STARKNET_NETWORKS.SN_DEVNET.rpcUrls[0]);
  const elsewhere = override ? "" : " Set a custom RPC under Advanced if yours runs elsewhere.";
  return `<p class="hint">Expects a node at ${endpoint} started with --chain-id SN_DEVNET.${elsewhere}</p>`;
};

const strk20ConfigFor = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): Strk20NetworkConfig | null =>
  preferences && isStarknetNetworkId(status.networkId)
    ? (preferences.strk20Networks?.[status.networkId] ?? null)
    : null;

const explorerApiUrlFor = (status: WalletStatus, preferences: WalletPreferences | null): string =>
  preferences && isStarknetNetworkId(status.networkId)
    ? (preferences.explorerApiUrls?.[status.networkId] ?? "")
    : "";

const nostrRelayUrlFor = (preferences: WalletPreferences | null): string =>
  preferences?.nostrRelayUrl ?? "";

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

const explorerFallbackForm = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
  allowed: boolean,
): string =>
  `<form id="explorer-fallback-form">
    ${textField({
      autocomplete: "off",
      className: "mono",
      label: `Explorer data API for ${status.network}`,
      name: "apiUrl",
      placeholder: "https://…/v1",
      spellcheck: false,
      type: "url",
      value: explorerApiUrlFor(status, preferences),
    })}
    ${checkboxField({
      checked: allowed,
      name: "explorerFallback",
      text: "Use this explorer for activity, and as a fallback when the RPC fails",
    })}
    ${button({
      icon: "check",
      label: "Save explorer",
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
  flowHeader("Network", status) +
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
      ${devnetHint(status, preferences)}
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
 * prover, and explorer-fallback settings, away from the primary network picker.
 * The NFT-indexer field is withheld while the collectibles journey is parked. Read-only — every field submits a privileged message and the
 * rendered state always comes from the preferences the background returned.
 */
export const advancedNetworkFlow = (
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string => {
  const privacy = strk20ConfigFor(status, preferences);
  const explorerAllowed = explorerFallbackFor(status, preferences);
  return (
    flowHeader("Endpoints", status) +
    flowScreen(
      "advanced-network",
      `<section class="section">
      <p class="review-flag" role="note">Only use endpoints you trust. Your browser asks before granting access to a new service host.</p>
      ${contextHelp(
        "advanced-endpoint-privacy",
        "What an endpoint can learn",
        "Each service sees the requests sent to it. Use only ones you trust. Clear a field to restore the default.",
      )}
      <div class="disclosure-stack">
        ${endpointDisclosure(
          "rpc",
          "RPC endpoint",
          rpcOverrideFor(status, preferences) ? "Custom" : "Default",
          `<form id="rpc-form">
            ${textField({
              autocomplete: "off",
              className: "mono",
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
          "Explorer data",
          `${explorerApiUrlFor(status, preferences) ? "Custom" : "Default"} · ${explorerAllowed ? "Allowed" : "Off"}`,
          explorerFallbackForm(status, preferences, explorerAllowed),
        )}
        ${endpointDisclosure(
          "strk20-services",
          "STRK20 privacy services",
          privacy ? "Configured" : "Off",
          strk20ServicesForm(status.network, privacy),
        )}
        ${endpointDisclosure(
          "nostr-relay",
          "Multisig coordination relay",
          nostrRelayUrlFor(preferences) ? "Custom" : "Reviewed defaults",
          `<form id="nostr-relay-form">
            ${textField({
              autocomplete: "off",
              className: "mono",
              label: "Custom Nostr relay",
              name: "relayUrl",
              placeholder: "wss://relay.example",
              spellcheck: false,
              type: "url",
              value: nostrRelayUrlFor(preferences),
            })}
            ${button({
              icon: "check",
              label: "Save relay",
              type: "submit",
              variant: "secondary",
            })}
            <p id="nostr-relay-result" role="status"></p>
          </form>`,
        )}
        ${endpointDisclosure(
          "product-analytics",
          "Product analytics",
          (preferences?.productAnalytics ?? true) ? "On" : "Off",
          `${checkboxField({
            attributes: { id: "product-analytics" },
            checked: preferences?.productAnalytics ?? true,
            name: "productAnalytics",
            text: "Share pseudonymous gateway usage (on by default)",
          })}
          <p class="hint">Helps Bramble understand feature usage and failures.</p>`,
        )}
        ${endpointDisclosure(
          "reliability-diagnostics",
          "Reliability diagnostics",
          preferences?.reliabilityDiagnostics ? "On" : "Off",
          `${checkboxField({
            attributes: { id: "reliability-diagnostics" },
            checked: preferences?.reliabilityDiagnostics ?? false,
            name: "reliabilityDiagnostics",
            text: "Keep anonymous RPC and explorer reliability counters on this device",
          })}
          <p class="hint">Stays on this device until you export it.</p>
          ${button({ attributes: { id: "diagnostics-export" }, icon: "receive", label: "Download diagnostics" })}`,
        )}
      </div>
    </section>`,
    )
  );
};
