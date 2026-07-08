/**
 * Bindings for endpoint-URL settings forms on the network flow: the per-network
 * RPC override and the STRK20 prover endpoint. Extracted from the side panel
 * entrypoint to keep it within the size budget.
 */
import type { WalletStatus } from "../popup/responses";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";

/**
 * Dependencies the endpoint bindings close over.
 */
export type EndpointUiDeps = {
  readonly app: Element | null;
  readonly networkId: () => string;
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

/**
 * Binds the RPC-override and STRK20-prover endpoint forms.
 */
export const bindEndpointSettings = (deps: EndpointUiDeps): void => {
  bindEndpointForm(deps, "#rpc-form", "rpcUrl", "RPC endpoint", (rpcUrl) =>
    deps.wallet.setRpcOverride(deps.networkId(), rpcUrl),
  );
  bindEndpointForm(deps, "#strk20-prover-form", "proverUrl", "Prover endpoint", (proverUrl) =>
    deps.wallet.setStrk20ProverUrl(proverUrl),
  );
};
