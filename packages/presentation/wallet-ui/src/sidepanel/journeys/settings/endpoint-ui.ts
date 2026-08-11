/**
 * Bindings for endpoint-URL settings forms on the network flow: the per-network
 * RPC override and the STRK20 prover endpoint. Extracted from the side panel
 * entrypoint to keep it within the size budget.
 */

import type { Strk20NetworkConfig } from "@mc-wallet/privacy/config";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";

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
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
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
): void => {
  const form = deps.app?.querySelector<HTMLFormElement>(formId);
  const result = deps.app?.querySelector<HTMLElement>(`${formId.replace("-form", "")}-result`);
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const fail = `${noun} update failed`;
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = String(new FormData(form).get(field) ?? "").trim();
    buttonBusy(submitButton, true);
    void submit(value).then(
      async () => {
        showToast(`${noun} ${value ? "saved" : "reset"}`, "success");
        await deps.render(await deps.wallet.loadStatus());
      },
      (error: unknown) => {
        const message = errorMessage(error, fail);
        showToast(message, "error");
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
    void deps.wallet.setStrk20NetworkConfig(deps.networkId(), config).then(
      async () => {
        showToast(`Privacy services ${config ? "saved" : "disabled"}`, "success");
        deps.onStrk20ConfigChanged?.();
        await deps.render(await deps.wallet.loadStatus());
      },
      (error: unknown) => {
        const message = errorMessage(error, "Privacy service configuration failed");
        showToast(message, "error");
        if (result) {
          result.textContent = message;
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};

/**
 * Binds the RPC-override, STRK20-prover, and NFT-indexer endpoint forms.
 */
export const bindEndpointSettings = (deps: EndpointUiDeps): void => {
  bindEndpointForm(deps, "#rpc-form", "rpcUrl", "RPC endpoint", (rpcUrl) =>
    deps.wallet.setRpcOverride(deps.networkId(), rpcUrl),
  );
  bindStrk20Services(deps);
  bindEndpointForm(deps, "#nft-indexer-form", "indexerUrl", "Indexer endpoint", (indexerUrl) =>
    deps.wallet.setNftIndexerUrl(indexerUrl),
  );
};
