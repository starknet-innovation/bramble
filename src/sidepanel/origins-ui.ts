/**
 * Bindings for the connected-sites permissions manager: each row's revoke
 * button removes an origin's grant through the background and re-renders the
 * refreshed list.
 */
import type { WalletStatus } from "../popup/responses";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";

/**
 * Dependencies the connected-sites bindings close over.
 */
export type ConnectedSitesUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

/**
 * Binds the revoke buttons on the connected-sites flow.
 */
export const bindConnectedSites = ({ app, render, wallet }: ConnectedSitesUiDeps): void => {
  const result = app?.querySelector<HTMLElement>("#connected-sites-result");

  app?.querySelectorAll<HTMLButtonElement>("[data-revoke-origin]").forEach((button) => {
    button.addEventListener("click", () => {
      const origin = button.dataset.revokeOrigin;
      if (!origin) {
        return;
      }
      buttonBusy(button, true);
      void wallet.revokeOrigin(origin).then(
        async () => {
          showToast("Access revoked", "success");
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Revoke failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Revoke failed");
          }
          buttonBusy(button, false);
        },
      );
    });
  });
};
