/**
 * Bindings for endpoint-URL settings forms on the network flow: the per-network
 * RPC override, Nostr relay, and the STRK20 prover endpoint. Extracted from the side panel
 * entrypoint to keep it within the size budget.
 */

import { isServiceUrl } from "@mc-wallet/core/service-url";
import type { Strk20NetworkConfig } from "@mc-wallet/privacy/config";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { HostPermissionApi } from "../../runtime/runtime-global";
import { buttonBusy, errorDetails, errorMessage, showToast } from "../../shared/dom";

/**
 * Dependencies the endpoint bindings close over.
 */
export type EndpointUiDeps = {
  readonly app: Element | null;
  readonly networkId: () => string;
  /**
   * Called after the STRK20 service routing changes so stale shielded-balance
   * discovery state (including a sticky error from the previous endpoints) is
   * dropped and discovery re-runs against the new configuration.
   */
  readonly onStrk20ConfigChanged?: () => void;
  readonly permissions?: HostPermissionApi;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

const requestHostAccess = (
  permissions: HostPermissionApi | undefined,
  urls: readonly string[],
): Promise<boolean> => {
  const configured = urls.filter(Boolean);
  if (!configured.every(isServiceUrl)) {
    return Promise.reject(new Error("Enter a secure HTTPS service URL"));
  }
  const origins = [...new Set(configured.map((value) => `${new URL(value).origin}/*`))];
  if (origins.length === 0) return Promise.resolve(true);
  if (!permissions) {
    return Promise.reject(new Error("Chrome host permission controls are unavailable"));
  }
  return permissions.request({ origins });
};

// Wires an endpoint-URL settings form to its save handler, showing a
// saved/reset toast and re-rendering, or the failure message. `noun` names the
// endpoint in every toast/status line.
const bindEndpointForm = (
  deps: EndpointUiDeps,
  formId: string,
  field: string,
  noun: string,
  submit: (value: string) => Promise<unknown>,
  requestPermission = true,
): void => {
  const form = deps.app?.querySelector<HTMLFormElement>(formId);
  const result = deps.app?.querySelector<HTMLElement>(`${formId.replace("-form", "")}-result`);
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const fail = `${noun} update failed`;
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = String(new FormData(form).get(field) ?? "").trim();
    buttonBusy(submitButton, true);
    const access = requestPermission
      ? requestHostAccess(deps.permissions, [value])
      : Promise.resolve(true);
    void access
      .then((granted) => {
        if (!granted) throw new Error("Chrome did not grant access to that service host");
        return submit(value);
      })
      .then(
        async () => {
          showToast(`${noun} ${value ? "saved" : "reset"}`, "success", form);
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          const message = errorMessage(error, fail);
          showToast(message, "error", form, errorDetails(error, fail));
          if (result) {
            result.textContent = message;
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

const bindStrk20Services = (deps: EndpointUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#strk20-services-form");
  const result = deps.app?.querySelector<HTMLElement>("#strk20-services-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const field = (name: string): string => String(data.get(name) ?? "").trim();
    const discoveryUrl = field("discoveryUrl");
    const ohttpEnabled = data.get("ohttpEnabled") === "on";
    const proverUrl = field("proverUrl");
    const poolAddress = field("poolAddress");
    const subaccountAnonymizerAddress = field("subaccountAnonymizerAddress");
    const ohttpRelayUrl = field("ohttpRelayUrl");
    const paymasterUrl = field("paymasterUrl");
    const feeToken = field("feeToken");
    const empty = [
      discoveryUrl,
      proverUrl,
      poolAddress,
      subaccountAnonymizerAddress,
      ohttpRelayUrl,
      paymasterUrl,
      feeToken,
    ].every((value) => value.length === 0);
    const config: Strk20NetworkConfig | null = empty
      ? null
      : {
          discoveryUrl,
          ...(ohttpEnabled ? { ohttpEnabled: true } : {}),
          poolAddress,
          proverUrl,
          ...(subaccountAnonymizerAddress ? { subaccountAnonymizerAddress } : {}),
          ...(ohttpRelayUrl ? { ohttpRelayUrl } : {}),
          ...(paymasterUrl || feeToken ? { paymaster: { feeToken, url: paymasterUrl } } : {}),
        };
    buttonBusy(submitButton, true);
    void requestHostAccess(deps.permissions, [discoveryUrl, ohttpRelayUrl, paymasterUrl, proverUrl])
      .then((granted) => {
        if (!granted) throw new Error("Chrome did not grant access to those service hosts");
        return deps.wallet.setStrk20NetworkConfig(deps.networkId(), config);
      })
      .then(
        async () => {
          showToast(`Privacy services ${config ? "saved" : "disabled"}`, "success", form);
          deps.onStrk20ConfigChanged?.();
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          const fallback = "Privacy service configuration failed";
          const message = errorMessage(error, fallback);
          showToast(message, "error", form, errorDetails(error, fallback));
          if (result) {
            result.textContent = message;
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

// The explorer API and its fallback consent are one atomic privacy decision:
// the endpoint may see the account address only after every RPC has failed.
// Submitted explicitly rather than on toggle so an accidental tap never
// records consent, and re-rendered from the stored preferences so the form
// reflects what the background actually holds.
const bindExplorerFallback = (deps: EndpointUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#explorer-fallback-form");
  const result = deps.app?.querySelector<HTMLElement>("#explorer-fallback-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const apiUrl = String(data.get("apiUrl") ?? "").trim();
    const enabled = data.get("explorerFallback") === "on";
    buttonBusy(submitButton, true);
    void requestHostAccess(deps.permissions, [apiUrl])
      .then((granted) => {
        if (!granted) throw new Error("Chrome did not grant access to that explorer host");
        return deps.wallet.setExplorerFallback(deps.networkId(), enabled, apiUrl);
      })
      .then(
        async () => {
          showToast(`Explorer fallback ${enabled ? "allowed" : "turned off"}`, "success", form);
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          const fallback = "Explorer fallback update failed";
          const message = errorMessage(error, fallback);
          showToast(message, "error", form, errorDetails(error, fallback));
          if (result) {
            result.textContent = message;
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

/**
 * Binds the RPC-override, explorer-fallback, STRK20-prover, and NFT-indexer
 * forms on the advanced-endpoints screen.
 */
export const bindEndpointSettings = (deps: EndpointUiDeps): void => {
  bindEndpointForm(deps, "#rpc-form", "rpcUrl", "RPC endpoint", (rpcUrl) =>
    deps.wallet.setRpcOverride(deps.networkId(), rpcUrl),
  );
  bindExplorerFallback(deps);
  bindStrk20Services(deps);
  bindEndpointForm(
    deps,
    "#nostr-relay-form",
    "relayUrl",
    "Coordination relay",
    (relayUrl) => deps.wallet.setNostrRelayUrl(relayUrl),
    false,
  );
  bindEndpointForm(deps, "#nft-indexer-form", "indexerUrl", "Indexer endpoint", (indexerUrl) =>
    deps.wallet.setNftIndexerUrl(indexerUrl),
  );
};
