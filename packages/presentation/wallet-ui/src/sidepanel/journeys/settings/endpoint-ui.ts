/**
 * Bindings for endpoint-URL settings forms on the network flow: the per-network
 * RPC override, Nostr relay, and the STRK20 prover endpoint. Extracted from the side panel
 * entrypoint to keep it within the size budget.
 */

import { canonicalServiceUrl, canonicalWebSocketServiceUrl } from "@bramble/core/service-url";
import type { Strk20NetworkConfig } from "@bramble/privacy/config";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import type { HostPermissionApi } from "../../runtime/runtime-global";
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";

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

// Characters refused in a typed endpoint rather than saved percent-encoded: in
// a pasted URL they usually split a key, and encoding them would save a key the
// person never typed.
const TYPED_BREAK = /[\s"<>`]/u;
const SERVICE_REFUSAL =
  "Enter a secure HTTPS service URL with no spaces, quotes, angle brackets or backticks";
const RELAY_REFUSAL =
  "Enter a secure WSS relay URL with no spaces, quotes, angle brackets or backticks";

// What a person typed, in the canonical spelling the store accepts: the URL
// parser fixes case, a default port, slashes and dot segments here, so a URL
// that differs only in those is saved as the request it makes rather than
// refused. Empty stays empty, which resets the endpoint. Anything else without
// a canonical spelling throws the refusal, before any host-permission prompt.
const typedEndpoint = (value: string, relay = false): string => {
  if (value === "") return "";
  const spell = relay ? canonicalWebSocketServiceUrl : canonicalServiceUrl;
  const url = TYPED_BREAK.test(value) ? null : spell(value);
  if (url === null) throw relay ? new Error(RELAY_REFUSAL) : new Error(SERVICE_REFUSAL);
  return url;
};

// Asks for the hosts of endpoints already passed through `typedEndpoint`.
const requestHostAccess = (
  permissions: HostPermissionApi | undefined,
  urls: readonly string[],
): Promise<boolean> => {
  const configured = urls.filter(Boolean);
  const origins = [...new Set(configured.map((value) => `${new URL(value).origin}/*`))];
  if (origins.length === 0) return Promise.resolve(true);
  if (!permissions) {
    return Promise.reject(new Error("Host permission controls are unavailable in this browser"));
  }
  return permissions.request({ origins });
};

// Wires an endpoint-URL settings form to its save handler, showing a
// saved/reset toast and re-rendering, or the failure message. `noun` names the
// endpoint in every toast/status line. A relay is a WSS endpoint and, as
// before, skips the host-permission request.
const bindEndpointForm = (
  deps: EndpointUiDeps,
  formId: string,
  field: string,
  noun: string,
  submit: (value: string) => Promise<unknown>,
  relay = false,
): void => {
  const form = deps.app?.querySelector<HTMLFormElement>(formId);
  const result = deps.app?.querySelector<HTMLElement>(`${formId.replace("-form", "")}-result`);
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const fail = `${noun} update failed`;
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = String(new FormData(form).get(field) ?? "").trim();
    buttonBusy(submitButton, true);
    void Promise.resolve()
      .then(async () => {
        const value = typedEndpoint(typed, relay);
        const granted = relay || (await requestHostAccess(deps.permissions, [value]));
        if (!granted) throw new Error("Your browser did not grant access to that service host");
        return submit(value);
      })
      .then(
        async () => {
          showToast(`${noun} ${typed ? "saved" : "reset"}`, "success", form);
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorDetails(error, fail), "error", form, errorDetails(error, fail));
          if (result) {
            result.textContent = errorLine(error, fail);
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
    const shadowAccountAnonymizerAddress = field("shadowAccountAnonymizerAddress");
    const ohttpRelayUrl = field("ohttpRelayUrl");
    const paymasterUrl = field("paymasterUrl");
    const feeToken = field("feeToken");
    const empty = [
      discoveryUrl,
      proverUrl,
      poolAddress,
      shadowAccountAnonymizerAddress,
      ohttpRelayUrl,
      paymasterUrl,
      feeToken,
    ].every((value) => value.length === 0);
    buttonBusy(submitButton, true);
    void Promise.resolve()
      .then(async () => {
        const urls = {
          discoveryUrl: typedEndpoint(discoveryUrl),
          ohttpRelayUrl: typedEndpoint(ohttpRelayUrl),
          paymasterUrl: typedEndpoint(paymasterUrl),
          proverUrl: typedEndpoint(proverUrl),
        };
        const config: Strk20NetworkConfig | null = empty
          ? null
          : {
              discoveryUrl: urls.discoveryUrl,
              ...(ohttpEnabled ? { ohttpEnabled: true } : {}),
              poolAddress,
              proverUrl: urls.proverUrl,
              ...(shadowAccountAnonymizerAddress ? { shadowAccountAnonymizerAddress } : {}),
              ...(urls.ohttpRelayUrl ? { ohttpRelayUrl: urls.ohttpRelayUrl } : {}),
              ...(urls.paymasterUrl || feeToken
                ? { paymaster: { feeToken, url: urls.paymasterUrl } }
                : {}),
            };
        if (!(await requestHostAccess(deps.permissions, Object.values(urls)))) {
          throw new Error("Your browser did not grant access to those service hosts");
        }
        return deps.wallet.setStrk20NetworkConfig(deps.networkId(), config);
      })
      .then(
        async () => {
          showToast(`Privacy services ${empty ? "disabled" : "saved"}`, "success", form);
          deps.onStrk20ConfigChanged?.();
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          const fallback = "Privacy service configuration failed";
          showToast(errorDetails(error, fallback), "error", form, errorDetails(error, fallback));
          if (result) {
            result.textContent = errorLine(error, fallback);
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
    const typed = String(data.get("apiUrl") ?? "").trim();
    const enabled = data.get("explorerFallback") === "on";
    buttonBusy(submitButton, true);
    void Promise.resolve()
      .then(async () => {
        const apiUrl = typedEndpoint(typed);
        if (!(await requestHostAccess(deps.permissions, [apiUrl]))) {
          throw new Error("Your browser did not grant access to that explorer host");
        }
        return deps.wallet.setExplorerFallback(deps.networkId(), enabled, apiUrl);
      })
      .then(
        async () => {
          showToast(`Explorer fallback ${enabled ? "allowed" : "turned off"}`, "success", form);
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          const fallback = "Explorer fallback update failed";
          showToast(errorDetails(error, fallback), "error", form, errorDetails(error, fallback));
          if (result) {
            result.textContent = errorLine(error, fallback);
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

/**
 * Binds the RPC-override, explorer-fallback, and STRK20-prover forms on the
 * advanced-endpoints screen. The NFT-indexer form is not rendered while the
 * collectibles journey is parked, so nothing binds it.
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
    true,
  );
};
