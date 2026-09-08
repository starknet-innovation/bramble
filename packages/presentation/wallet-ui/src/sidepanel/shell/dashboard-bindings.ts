/**
 * Event wiring for dashboard controls that don't change the active view:
 * saving an address-book entry and deciding a pending dapp approval. Split
 * from the side panel entrypoint to keep it within the size budget.
 */

import { isStarknetNetworkId } from "@bramble/wallet-model/networks";
import { parseWalletContactCard, walletContactCard } from "@bramble/wallet-model/preferences";
import { readApprovalAction } from "../../popup/actions";
import type { WalletStatus } from "../../popup/responses/responses";
import type { SidepanelWallet } from "../runtime/runtime";
import { buttonBusy, errorMessage, renderFragment, showToast } from "../shared/dom";
import { accountLabel } from "../shared/parts";
import { qrSvg } from "../shared/qr";

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

  const walletCardField = form?.querySelector<HTMLTextAreaElement>('[name="walletCard"]');
  if (form && walletCardField)
    walletCardField.addEventListener("change", () => {
      const value = walletCardField.value.trim();
      if (!value) {
        walletCardField.setCustomValidity("");
        return;
      }
      const card = parseWalletContactCard(value);
      const networkId = form.elements.namedItem("networkId");
      const currentNetwork = networkId instanceof HTMLInputElement ? networkId.value : "";
      if (!card || card.networkId !== currentNetwork) {
        const message = card
          ? "This wallet card belongs to a different network."
          : "That wallet card is not recognized.";
        walletCardField.setCustomValidity(message);
        if (result) result.textContent = message;
        return;
      }
      walletCardField.setCustomValidity("");
      for (const [name, value] of [
        ["address", card.address],
        ["publicKeyX", card.publicKeyX ?? ""],
        ["nostrPublicKey", card.nostrPublicKey ?? ""],
      ] as const) {
        const input = form.elements.namedItem(name);
        if (input instanceof HTMLInputElement) input.value = value;
      }
      if (result) result.textContent = "Wallet card verified. Add a label, then save.";
      const label = form.elements.namedItem("label");
      if (label instanceof HTMLInputElement) label.focus({ preventScroll: true });
    });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    buttonBusy(submitButton, true);
    void wallet
      .saveAddress(
        String(data.get("label") ?? ""),
        String(data.get("address") ?? "").trim(),
        String(data.get("networkId") ?? ""),
        String(data.get("publicKeyX") ?? "").trim() || undefined,
        String(data.get("nostrPublicKey") ?? "").trim() || undefined,
      )
      .then(
        async () => {
          showToast("Address saved", "success", form);
          if (result) {
            result.textContent = "Address saved";
          }
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Address save failed"), "error", form);
          if (result) {
            result.textContent = errorMessage(error, "Address save failed");
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

/** Saturates the account's public wallet card without putting Nostr derivation in polling. */
export const bindReceiveWalletCard = ({ app, wallet }: BindingContext): void => {
  const root = app?.querySelector<HTMLElement>("[data-receive-wallet-card]");
  const address = root?.dataset["receiveAddress"];
  const networkId = root?.dataset["receiveNetwork"];
  const publicKeyX = root?.dataset["receiveSignerKey"];
  if (!root || !address || !isStarknetNetworkId(networkId) || !publicKeyX) return;
  void wallet.loadNostrPublicKey().then(
    (nostrPublicKey) => {
      if (!root.isConnected) return;
      const card = walletContactCard({ address, networkId, nostrPublicKey, publicKeyX });
      const qr = root.querySelector<HTMLElement>("[data-receive-qr]");
      const cardCopy = root.querySelector<HTMLButtonElement>("[data-wallet-card-copy]");
      const keyRow = root.querySelector<HTMLElement>("[data-nostr-key-row]");
      const keyStatus = keyRow?.querySelector<HTMLElement>("[data-nostr-key-status]");
      const keyValue = keyRow?.querySelector<HTMLElement>("[data-nostr-key-value]");
      const key = root.querySelector<HTMLElement>("[data-nostr-key]");
      const keyCopy = keyRow?.querySelector<HTMLButtonElement>("[data-copy]");
      if (qr) renderFragment(qr, qrSvg(card, "QR code for wallet contact card"));
      if (qr) qr.removeAttribute("aria-busy");
      root.dataset["walletCardState"] = "ready";
      if (cardCopy) {
        cardCopy.dataset["copy"] = card;
        cardCopy.disabled = false;
        if (cardCopy.lastChild) cardCopy.lastChild.textContent = "Copy wallet card";
      }
      if (keyStatus) keyStatus.hidden = true;
      if (key) {
        key.textContent = accountLabel(nostrPublicKey);
        key.title = nostrPublicKey;
      }
      if (keyCopy) keyCopy.dataset["copy"] = nostrPublicKey;
      if (keyValue) keyValue.hidden = false;
    },
    () => {
      if (!root.isConnected) return;
      const qr = root.querySelector<HTMLElement>("[data-receive-qr]");
      const cardCopy = root.querySelector<HTMLButtonElement>("[data-wallet-card-copy]");
      const keyStatus = root.querySelector<HTMLElement>("[data-nostr-key-status]");
      const keyValue = root.querySelector<HTMLElement>("[data-nostr-key-value]");
      if (qr) {
        renderFragment(qr, qrSvg(address, "QR code for account address"));
        qr.removeAttribute("aria-busy");
      }
      root.dataset["walletCardState"] = "unavailable";
      if (cardCopy) cardCopy.hidden = true;
      if (keyStatus) {
        keyStatus.textContent = "Coordination is unavailable. Share the account address instead.";
        keyStatus.hidden = false;
      }
      if (keyValue) keyValue.hidden = true;
    },
  );
};

/**
 * Wires the approve/deny buttons on pending dapp requests (the takeover screen
 * and the Activity list share one decision path) plus the takeover's "Not now"
 * snooze control.
 */
export const bindApprovals = ({ app, render, snoozeApproval, wallet }: BindingContext): void => {
  const result = app?.querySelector<HTMLElement>("#approval-result");
  const live = app?.querySelector<HTMLElement>("#approval-live");
  const liveTitle = app?.querySelector<HTMLElement>("#approval-live-title");
  const liveCopy = app?.querySelector<HTMLElement>("#approval-live-copy");
  const deciding = new Set<string>();
  app?.querySelectorAll<HTMLButtonElement>("[data-approval-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["approvalId"];
      const action = readApprovalAction(button.dataset["approvalAction"]);
      if (!id || !action || deciding.has(id)) {
        return;
      }
      deciding.add(id);
      const approvalCard = button.closest<HTMLElement>(".request-card");
      if (approvalCard) {
        approvalCard.dataset["state"] = "working";
      }
      if (live) {
        live.hidden = false;
      }
      if (liveTitle) {
        liveTitle.textContent = action === "approve" ? "Authorizing request" : "Denying request";
      }
      if (liveCopy) {
        liveCopy.textContent =
          action === "approve"
            ? "The reviewed request is locked while the wallet signs and submits it."
            : "The wallet is returning control to the requesting site.";
      }
      app
        ?.querySelectorAll<HTMLButtonElement>("[data-approval-id], [data-approval-later]")
        .forEach((control) => {
          if (control.dataset["approvalId"] === id || control.dataset["approvalLater"] === id) {
            buttonBusy(control, true);
          }
        });
      if (result) {
        result.textContent =
          action === "approve" ? "Approved. Signing and broadcasting…" : "Rejecting request…";
      }
      // The fee this card painted, read back off the control that was clicked
      // rather than from any later status refresh, so the figure the user saw is
      // the figure the decision reports. A card that showed no fee reports none.
      const overallFee = button.dataset["approvalFee"];
      const unit = button.dataset["approvalFeeUnit"];
      const reviewedFee =
        overallFee !== undefined && unit !== undefined ? { overallFee, unit } : undefined;
      void wallet.decideApproval(id, action === "approve", reviewedFee).then(
        async () => {
          showToast(
            action === "approve" ? "Request approved" : "Request denied",
            "success",
            button,
          );
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Approval failed"), "error", button);
          if (result) {
            result.textContent = errorMessage(error, "Approval failed");
          }
          // The background atomically consumes an approval before execution.
          // Repaint after any executor error so stale controls cannot decide the
          // already-removed id and surface a misleading "approval not found".
          void wallet.loadStatus().then(render, () => {
            deciding.delete(id);
          });
        },
      );
    });
  });
  // Fee-estimate retry on a queued invoke card: asks the background to
  // re-estimate against the approval's pinned account/network, then repaints so
  // the card shows the refreshed fee state. Failures surface as a toast and
  // re-enable the button; the approval itself is untouched either way.
  app?.querySelectorAll<HTMLButtonElement>("[data-approval-retry-fee]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["approvalRetryFee"];
      if (!id) {
        return;
      }
      buttonBusy(button, true);
      void wallet.retryApprovalFee(id).then(
        async () => render(await wallet.loadStatus()),
        (error: unknown) => {
          showToast(errorMessage(error, "Fee estimate failed"), "error", button);
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
