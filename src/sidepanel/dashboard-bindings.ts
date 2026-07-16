/**
 * Event wiring for dashboard controls that don't change the active view:
 * saving an address-book entry and deciding a pending dapp approval. Split
 * from the side panel entrypoint to keep it within the size budget.
 */

import { readApprovalAction } from "../popup/actions";
import type { WalletStatus } from "../popup/responses";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";

/**
 * Shared context: the app root, the runtime client, and a full re-render.
 * `snoozeApproval` (optional; the takeover's "Not now") parks a pending
 * request in the Activity list for this panel session without deciding it.
 */
export type BindingContext = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly snoozeApproval?: (id: string) => void;
  readonly wallet: SidepanelWallet;
};

/**
 * Wires the address-book save form.
 */
export const bindAddressBook = ({ app, render, wallet }: BindingContext): void => {
  const form = app?.querySelector<HTMLFormElement>("#address-form");
  const result = app?.querySelector<HTMLElement>("#address-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    buttonBusy(submitButton, true);
    void wallet
      .saveAddress(
        String(data.get("label") ?? ""),
        String(data.get("address") ?? "").trim(),
        String(data.get("networkId") ?? ""),
      )
      .then(
        async () => {
          showToast("Address saved", "success");
          if (result) {
            result.textContent = "Address saved";
          }
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Address save failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Address save failed");
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

/**
 * Wires the approve/deny buttons on pending dapp requests (the takeover screen
 * and the Activity list share one decision path) plus the takeover's "Not now"
 * snooze control.
 */
export const bindApprovals = ({ app, render, snoozeApproval, wallet }: BindingContext): void => {
  const result = app?.querySelector<HTMLElement>("#approval-result");
  app?.querySelectorAll<HTMLButtonElement>("[data-approval-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["approvalId"];
      const action = readApprovalAction(button.dataset["approvalAction"]);
      if (!id || !action) {
        return;
      }
      buttonBusy(button, true);
      void wallet.decideApproval(id, action === "approve").then(
        async () => {
          showToast(action === "approve" ? "Request approved" : "Request denied", "success");
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Approval failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Approval failed");
          }
          buttonBusy(button, false);
        },
      );
    });
  });
  app?.querySelectorAll<HTMLButtonElement>("[data-approval-later]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["approvalLater"];
      if (id) {
        snoozeApproval?.(id);
      }
    });
  });
};
