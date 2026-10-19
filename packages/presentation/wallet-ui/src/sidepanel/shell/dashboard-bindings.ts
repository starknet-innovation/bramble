/**
 * Event wiring for dashboard controls that don't change the active view:
 * saving an address-book entry and deciding a pending dapp approval. Split
 * from the side panel entrypoint to keep it within the size budget.
 */

import {
  canonicalAddress,
  isStarknetNetworkId,
  normalizeFeltInput,
} from "@bramble/wallet-model/networks";
import { parseWalletContactCard, walletContactCard } from "@bramble/wallet-model/preferences";
import { readApprovalAction } from "../../popup/actions";
import type { WalletStatus } from "../../popup/responses/responses";
import { RECEIVE_QR_LABELS } from "../journeys/send/receive-view";
import type { SidepanelWallet } from "../runtime/runtime";
import { isOutcomeUnknown } from "../runtime/runtime-errors";
import { buttonBusy, errorDetails, errorLine, renderFragment, showToast } from "../shared/dom";
import { accountLabel } from "../shared/parts";
import { qrSvg } from "../shared/qr";
import { createStagePacer, type StagePacer, type StageTimers } from "../shared/stage-pacer";
import {
  addressBookDraft,
  clearAddressBookDraft,
  rememberAddressBookDraft,
  takeAddressBookLabelFocus,
} from "./address-draft";

// Approval kinds whose approval signs and submits a transaction (stamped on the
// approve control as data-approval-kind): only their unknown outcome says the
// approval may not have gone through (copy review bf08).
const TRANSACTION_APPROVALS: ReadonlySet<string> = new Set(["declare", "invoke", "strk20-invoke"]);

// What the panel says while a decision runs and when it lands. Closing a
// notice answers the site like Deny, but there was nothing to deny: no live
// line, and the toast says only that it closed.
const decisionWords = (
  action: "approve" | "deny",
  notice: boolean,
): {
  readonly done: string;
  readonly line: string;
  readonly pending: string;
  readonly title: string;
} => {
  if (notice) return { done: "Closed", line: "", pending: "", title: "" };
  return action === "approve"
    ? {
        done: "Request approved",
        line: "The reviewed request is locked while the wallet signs and submits it.",
        pending: "Approved. Signing and broadcasting…",
        title: "Authorizing request",
      }
    : {
        done: "Request denied",
        line: "The wallet is returning control to the requesting site.",
        pending: "Rejecting request…",
        title: "Denying request",
      };
};

/**
 * Shared context: the app root, the runtime client, and a full re-render.
 * `snoozeApproval` (optional; the takeover's "Not now") parks a pending
 * request in the Activity list for this panel session without deciding it.
 */
export type BindingContext = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly snoozeApproval?: (id: string) => void;
  /** Timer seam for the approval takeover's stage pacing; platform timers when absent. */
  readonly stageTimers?: StageTimers;
  readonly wallet: SidepanelWallet;
};

/**
 * Wires the address-book save form.
 */
export const bindAddressBook = ({ app, render, wallet }: BindingContext): void => {
  const form = app?.querySelector<HTMLFormElement>("#address-form");
  // The handoff lives until Save, or until this screen is gone. A shell
  // repaint rebuilds the form from an empty template and reads it again.
  if (!form) {
    clearAddressBookDraft();
    return;
  }
  const result = app?.querySelector<HTMLElement>("#address-result");
  const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  // Arriving from Send's "Save address": the address is already known, so the
  // form opens on it with only the label left to fill. A later paint fills
  // whichever of the two fields the focus restore left empty.
  const addressField = form.querySelector<HTMLInputElement>('[name="address"]');
  const labelField = form.querySelector<HTMLInputElement>('[name="label"]');
  const draft = addressBookDraft();
  if (addressField && addressField.value.trim() === "" && draft.address) {
    addressField.value = draft.address;
  }
  if (labelField && labelField.value.trim() === "" && draft.label) {
    labelField.value = draft.label;
  }
  if (takeAddressBookLabelFocus()) {
    labelField?.focus({ preventScroll: true });
  }
  const remember = (): void => {
    rememberAddressBookDraft(addressField?.value ?? "", labelField?.value ?? "");
  };
  addressField?.addEventListener("input", remember);
  labelField?.addEventListener("input", remember);

  // Everything past label and address is opt-in: the form asked for five fields
  // to record a name and an address, which is why it read as complex.
  const advanced = form?.querySelector<HTMLButtonElement>("#advanced-address");
  const advancedFields = form?.querySelector<HTMLElement>("#address-advanced-fields");
  advanced?.addEventListener("click", () => {
    const open = advanced.getAttribute("aria-checked") !== "true";
    advanced.setAttribute("aria-checked", String(open));
    advanced.dataset["checked"] = String(open);
    advancedFields?.toggleAttribute("hidden", !open);
  });

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
      rememberAddressBookDraft(addressField?.value ?? "", labelField?.value ?? "");
      const label = form.elements.namedItem("label");
      if (label instanceof HTMLInputElement) label.focus({ preventScroll: true });
    });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    buttonBusy(submitButton, true);
    // Canonicalised here, the way the wallet-card path already was: the
    // background takes lowercase hex only, so an address pasted as 0x04F2…
    // was refused as a malformed request even though Send had just accepted
    // that exact text. An unparseable value is passed through untouched so the
    // background still reports it rather than this quietly sending "null".
    const typed = String(data.get("address") ?? "");
    const publicKeyX = normalizeFeltInput(String(data.get("publicKeyX") ?? ""));
    void wallet
      .saveAddress(
        String(data.get("label") ?? ""),
        canonicalAddress(typed) ?? typed.trim(),
        String(data.get("networkId") ?? ""),
        publicKeyX || undefined,
        String(data.get("nostrPublicKey") ?? "").trim() || undefined,
      )
      .then(
        async () => {
          clearAddressBookDraft();
          showToast("Address saved", "success", form);
          if (result) {
            result.textContent = "Address saved";
          }
          await render(await wallet.loadStatus());
        },
        (error: unknown) => {
          showToast(errorDetails(error, "Address save failed"), "error", form);
          if (result) {
            result.textContent = errorLine(error, "Address save failed");
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

/**
 * Binds the Receive card's QR switch and saturates the account's public wallet
 * card without putting Nostr derivation in polling. The address QR is painted
 * by the view and never waits: the card is an additional choice that becomes
 * selectable once its coordination key is derived, and disappears if it cannot be.
 */
export const bindReceiveWalletCard = ({ app, wallet }: BindingContext): void => {
  const root = app?.querySelector<HTMLElement>("[data-receive-wallet-card]");
  const address = root?.dataset["receiveAddress"];
  const networkId = root?.dataset["receiveNetwork"];
  const publicKeyX = root?.dataset["receiveSignerKey"];
  if (!root || !address || !isStarknetNetworkId(networkId) || !publicKeyX) return;
  const qr = root.querySelector<HTMLElement>("[data-receive-qr]");
  const options = [...root.querySelectorAll<HTMLButtonElement>("[data-receive-payload]")];
  const showPayload = (payload: "address" | "card"): void => {
    const card = root.dataset["receiveCard"];
    if (payload === "card" && !card) return;
    if (qr) {
      renderFragment(
        qr,
        payload === "card" && card
          ? qrSvg(card, RECEIVE_QR_LABELS.card)
          : qrSvg(address, RECEIVE_QR_LABELS.address),
      );
      qr.dataset["qrPayload"] = payload;
    }
    for (const option of options) {
      option.setAttribute("aria-pressed", String(option.dataset["receivePayload"] === payload));
    }
  };

  // Everything past the QR and the address is opt-in: receiving needs one
  // address, and the contact card and keys are for multisig coordination.
  // Closing Advanced hides the payload switch, so the QR goes back to the address
  // with it: a card QR under "Your Starknet address" with no way to switch it
  // is not something other wallets can scan.
  const advanced = root.querySelector<HTMLButtonElement>("#advanced-receive");
  const advancedFields = root.querySelector<HTMLElement>("#receive-advanced-fields");
  advanced?.addEventListener("click", () => {
    const open = advanced.getAttribute("aria-checked") !== "true";
    advanced.setAttribute("aria-checked", String(open));
    advanced.dataset["checked"] = String(open);
    advancedFields?.toggleAttribute("hidden", !open);
    if (!open) {
      showPayload("address");
    }
  });

  for (const option of options) {
    option.addEventListener("click", () => {
      const payload = option.dataset["receivePayload"];
      if (payload === "address" || payload === "card") showPayload(payload);
    });
  }
  void wallet.loadNostrPublicKey().then(
    (nostrPublicKey) => {
      if (!root.isConnected) return;
      const card = walletContactCard({ address, networkId, nostrPublicKey, publicKeyX });
      const cardOption = options.find((option) => option.dataset["receivePayload"] === "card");
      const cardCopy = root.querySelector<HTMLButtonElement>("[data-wallet-card-copy]");
      const keyRow = root.querySelector<HTMLElement>("[data-nostr-key-row]");
      const keyStatus = keyRow?.querySelector<HTMLElement>("[data-nostr-key-status]");
      const keyValue = keyRow?.querySelector<HTMLElement>("[data-nostr-key-value]");
      const key = root.querySelector<HTMLElement>("[data-nostr-key]");
      const keyCopy = keyRow?.querySelector<HTMLButtonElement>("[data-copy]");
      root.dataset["receiveCard"] = card;
      root.dataset["walletCardState"] = "ready";
      if (cardOption) cardOption.disabled = false;
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
      const payloadSwitch = root.querySelector<HTMLElement>("[data-receive-payload-switch]");
      const explainer = root.querySelector<HTMLElement>("[data-receive-card-explainer]");
      const cardCopy = root.querySelector<HTMLButtonElement>("[data-wallet-card-copy]");
      const keyStatus = root.querySelector<HTMLElement>("[data-nostr-key-status]");
      const keyValue = root.querySelector<HTMLElement>("[data-nostr-key-value]");
      root.dataset["walletCardState"] = "unavailable";
      if (payloadSwitch) payloadSwitch.hidden = true;
      if (explainer) explainer.hidden = true;
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
export const bindApprovals = ({
  app,
  render,
  snoozeApproval,
  stageTimers,
  wallet,
}: BindingContext): void => {
  const result = app?.querySelector<HTMLElement>("#approval-result");
  const live = app?.querySelector<HTMLElement>("#approval-live");
  const liveTitle = app?.querySelector<HTMLElement>("#approval-live-title");
  const liveCopy = app?.querySelector<HTMLElement>("#approval-live-copy");
  const deciding = new Set<string>();
  // A software approval can settle in a few milliseconds, which tore the
  // "Authorizing request" line down before it could be read (issue 436). The
  // decision itself starts at once; the outcome's paint, and the status read
  // it repaints from, wait for the line's minimum time on screen.
  const pacedOutcome = (): StagePacer<() => void> => {
    const paced = createStagePacer<() => void>({
      render: (paint) => paint(),
      sameStage: () => false,
      ...(stageTimers ? { timers: stageTimers } : {}),
    });
    paced.stage(() => undefined);
    return paced;
  };
  const showFailure = (error: unknown, button: HTMLButtonElement): void => {
    // An approved call whose reply was lost may be on chain: amber, not "failed".
    showToast(
      errorDetails(error, "Approval failed"),
      isOutcomeUnknown(error) ? "warning" : "error",
      button,
    );
    if (result) {
      result.textContent = errorLine(error, "Approval failed");
    }
  };
  app?.querySelectorAll<HTMLButtonElement>("[data-approval-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["approvalId"];
      const action = readApprovalAction(button.dataset["approvalAction"]);
      if (!id || !action || deciding.has(id)) {
        return;
      }
      deciding.add(id);
      const paced = pacedOutcome();
      const approvalCard = button.closest<HTMLElement>(".request-card");
      if (approvalCard) {
        approvalCard.dataset["state"] = "working";
      }
      const notice = approvalCard?.hasAttribute("data-approval-notice") === true;
      if (live && !notice) {
        live.hidden = false;
      }
      const words = decisionWords(action, notice);
      if (liveTitle) {
        liveTitle.textContent = words.title;
      }
      if (liveCopy) {
        liveCopy.textContent = words.line;
      }
      app
        ?.querySelectorAll<HTMLButtonElement>("[data-approval-id], [data-approval-later]")
        .forEach((control) => {
          if (control.dataset["approvalId"] === id || control.dataset["approvalLater"] === id) {
            buttonBusy(control, true);
          }
        });
      if (result) {
        result.textContent = words.pending;
      }
      // The fee this card painted, read back off the control that was clicked
      // rather than from any later status refresh, so the figure the user saw is
      // the figure the decision reports. A card that showed no fee reports none.
      const overallFee = button.dataset["approvalFee"];
      const unit = button.dataset["approvalFeeUnit"];
      const reviewedFee =
        overallFee !== undefined && unit !== undefined ? { overallFee, unit } : undefined;
      // Likewise the account a connection card named: read off the clicked
      // control, so the account the user saw is the one the decision reports.
      const reviewedAccountId = button.dataset["approvalAccount"];
      const transaction = TRANSACTION_APPROVALS.has(button.dataset["approvalKind"] ?? "");
      void wallet
        .decideApproval(id, action === "approve", reviewedFee, reviewedAccountId, transaction)
        .then(
          () => {
            // The status is read when the outcome paints, not when the decision
            // resolved: a snapshot taken up to the pacer's hold earlier could
            // repaint over a newer refresh (a request queued in the meantime).
            paced.settle(() => {
              showToast(words.done, "success", button);
              void wallet
                .loadStatus()
                .then(render)
                .catch(() => undefined);
            });
          },
          (error: unknown) => {
            // The background atomically consumes an approval before execution.
            // Repaint after any executor error so stale controls cannot decide the
            // already-removed id and surface a misleading "approval not found".
            paced.settle(() => {
              showFailure(error, button);
              void wallet
                .loadStatus()
                .then(render, () => {
                  deciding.delete(id);
                })
                .catch(() => undefined);
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
          showToast(errorDetails(error, "Fee estimate failed"), "error", button);
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
