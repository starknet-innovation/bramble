/** Confirmation review bindings: fee preparation, signer/mode choice, and submit. */

import { isMultisigConfirmationMode } from "../shared/multisig-confirmation";
import type { FeeEstimate } from "../starknet/fee-bounds";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { MultisigReviewFee } from "./multisig-runtime";
import { closeMultisigSheet, openMultisigSheet } from "./multisig-sheet-motion";
import type { MultisigUiDeps } from "./multisig-ui-deps";
import { formatFri } from "./parts";

const reviewSerials = new WeakMap<HTMLElement, number>();
// The fee this panel actually rendered, kept so the confirmation echoes back the
// exact figure the signer read. The background makes it the ceiling the
// co-signing invoke may sign under (MCW-V09-119), so a stale or invented value
// here would turn that guarantee into a decoration.
const reviewedFees = new WeakMap<HTMLElement, MultisigReviewFee>();

const nextReviewSerial = (panel: HTMLElement): number => {
  const serial = (reviewSerials.get(panel) ?? 0) + 1;
  reviewSerials.set(panel, serial);
  reviewedFees.delete(panel);
  return serial;
};

const submitButton = (panel: HTMLElement): HTMLButtonElement | null =>
  panel.querySelector<HTMLButtonElement>("[data-ms-confirm-submit]");

const selectedSignerId = (panel: HTMLElement | null): string | null =>
  panel?.querySelector<HTMLButtonElement>('[data-ms-confirm-signer][aria-pressed="true"]')?.dataset[
    "msConfirmSigner"
  ] ?? null;

const setSubmitLabel = (button: HTMLButtonElement, label: string): void => {
  const labelNode = [...button.childNodes].find((node) => node.nodeType === 3);
  if (labelNode) labelNode.textContent = label;
  else button.append(label);
};

const setChoicesDisabled = (panel: HTMLElement, disabled: boolean): void => {
  panel
    .querySelectorAll<HTMLButtonElement>(
      "[data-ms-confirm-mode-option], [data-ms-confirm-signer], [data-ms-confirm-retry-fee]",
    )
    .forEach((button) => {
      const target = button;
      target.disabled = disabled;
    });
};

const formatFee = (fee: FeeEstimate): string =>
  fee.unit === "FRI" ? formatFri(fee.overallFee) : `${fee.overallFee} ${fee.unit}`;

const prepareReview = async (deps: MultisigUiDeps, panel: HTMLElement): Promise<void> => {
  const serial = nextReviewSerial(panel);
  const mode = panel.dataset["msConfirmMode"];
  const proposalId = panel.dataset["msConfirmPanel"];
  const signerAccountId = selectedSignerId(panel);
  const submit = submitButton(panel);
  const fee = panel.querySelector<HTMLElement>("[data-ms-confirm-fee] strong");
  const retry = panel.querySelector<HTMLButtonElement>("[data-ms-confirm-retry-fee]");
  const status = panel.querySelector<HTMLElement>("[data-ms-confirm-status]");
  if (
    !isMultisigConfirmationMode(mode) ||
    !proposalId ||
    !signerAccountId ||
    !submit ||
    !fee ||
    !retry ||
    !status
  ) {
    return;
  }
  submit.disabled = true;
  panel.setAttribute("data-ms-review-ready", "false");
  fee.textContent = "Checking estimate…";
  retry.hidden = true;
  status.textContent = "Reviewing signer permission and network fee…";
  const acknowledgment = panel
    .closest(".allowance-row")
    ?.querySelector<HTMLInputElement>("[data-ms-ack]");
  try {
    const review = await deps.multisig.prepareConfirmation({
      mode,
      proposalId,
      signerAccountId,
      ...(acknowledgment?.checked === true ? { untrackedVerified: true } : {}),
    });
    if (
      reviewSerials.get(panel) !== serial ||
      review.mode !== mode ||
      review.proposalId !== proposalId ||
      review.signerAccountId !== signerAccountId
    ) {
      return;
    }
    if (review.feeEstimateFailed || !review.fee) {
      fee.textContent = "Unavailable";
      retry.hidden = false;
      status.textContent = "The fee could not be estimated. Retry before signing.";
      return;
    }
    fee.textContent = formatFee(review.fee);
    reviewedFees.set(panel, review.fee);
    panel.setAttribute("data-ms-review-ready", "true");
    submit.disabled = false;
    status.textContent = "Ready to sign. Nothing has been submitted yet.";
  } catch (error) {
    if (reviewSerials.get(panel) !== serial) return;
    fee.textContent = "Unavailable";
    retry.hidden = false;
    status.textContent = errorMessage(error, "Confirmation review failed");
  }
};

const closePanel = (deps: MultisigUiDeps, panel: HTMLElement, restoreFocus = true): void => {
  nextReviewSerial(panel);
  const proposalId = panel.dataset["msConfirmPanel"];
  const trigger = restoreFocus
    ? [...(deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-confirm-open]") ?? [])].find(
        (button) => button.dataset["msConfirmOpen"] === proposalId,
      )
    : null;
  closeMultisigSheet(panel, trigger);
};

/**
 * Binds the protected confirmation dialog without changing the active account.
 */
export const bindMultisigConfirmation = (deps: MultisigUiDeps): void => {
  const panels = [...(deps.app?.querySelectorAll<HTMLElement>("[data-ms-confirm-panel]") ?? [])];
  const panelFor = (proposalId: string): HTMLElement | undefined =>
    panels.find((panel) => panel.dataset["msConfirmPanel"] === proposalId);

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-confirm-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = panelFor(button.dataset["msConfirmOpen"] ?? "");
      if (!panel) return;
      const close = panel.querySelector<HTMLButtonElement>("[data-ms-confirm-cancel]");
      openMultisigSheet(panel, close);
      void prepareReview(deps, panel);
    });
  });

  for (const panel of panels) {
    panel.addEventListener("click", (event) => {
      if (event.target === panel) closePanel(deps, panel);
    });
    panel.addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") closePanel(deps, panel);
    });
  }

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-confirm-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.closest<HTMLElement>("[data-ms-confirm-panel]");
      if (panel) closePanel(deps, panel);
    });
  });

  deps.app
    ?.querySelectorAll<HTMLButtonElement>("[data-ms-confirm-mode-option]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const panel = button.closest<HTMLElement>("[data-ms-confirm-panel]");
        const mode = button.dataset["msConfirmModeOption"];
        const submit = panel ? submitButton(panel) : null;
        if (!panel || !submit || !isMultisigConfirmationMode(mode)) return;
        panel.dataset["msConfirmMode"] = mode;
        submit.dataset["msConfirmSubmitMode"] = mode;
        panel
          .querySelectorAll<HTMLButtonElement>("[data-ms-confirm-mode-option]")
          .forEach((option) => {
            option.setAttribute("aria-pressed", String(option === button));
          });
        setSubmitLabel(
          submit,
          mode === "confirm-and-execute" ? "Confirm & execute" : "Confirm proposal",
        );
        const note = panel.querySelector<HTMLElement>("[data-ms-confirm-note] p");
        if (note) {
          note.textContent =
            mode === "confirm-and-execute"
              ? "The contract rechecks quorum before execution. Review the exact effect and fee above before signing."
              : "This records one confirmation now. Execution remains a separate transaction after quorum.";
        }
        void prepareReview(deps, panel);
      });
    });

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-confirm-signer]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.closest<HTMLElement>("[data-ms-confirm-panel]");
      if (!panel || !button.dataset["msConfirmSigner"]) return;
      panel.querySelectorAll<HTMLButtonElement>("[data-ms-confirm-signer]").forEach((option) => {
        option.setAttribute("aria-pressed", String(option === button));
      });
      const submit = submitButton(panel);
      if (submit) submit.dataset["msSelectedSigner"] = button.dataset["msConfirmSigner"];
      void prepareReview(deps, panel);
    });
  });

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-confirm-retry-fee]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.closest<HTMLElement>("[data-ms-confirm-panel]");
      if (panel) void prepareReview(deps, panel);
    });
  });

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-confirm-submit]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.closest<HTMLElement>("[data-ms-confirm-panel]");
      const mode = button.dataset["msConfirmSubmitMode"];
      const proposalId = button.dataset["msConfirmSubmit"];
      const signerAccountId = selectedSignerId(panel);
      const status = panel?.querySelector<HTMLElement>("[data-ms-confirm-status]");
      if (
        !panel ||
        !status ||
        panel.dataset["msReviewReady"] !== "true" ||
        !isMultisigConfirmationMode(mode) ||
        !proposalId ||
        !signerAccountId
      ) {
        return;
      }
      const acknowledgment = panel
        .closest(".allowance-row")
        ?.querySelector<HTMLInputElement>("[data-ms-ack]");
      if (acknowledgment && !acknowledgment.checked) {
        showToast("Verify the proposal and check the acknowledgment first", "error");
        return;
      }
      const reviewedFee = reviewedFees.get(panel);
      buttonBusy(button, true);
      setChoicesDisabled(panel, true);
      panel.dataset["msSubmitting"] = "true";
      status.textContent =
        mode === "confirm-and-execute"
          ? "Authorizing one atomic confirmation and execution…"
          : "Authorizing this confirmation…";
      void deps.multisig
        .confirmProposal({
          mode,
          proposalId,
          ...(reviewedFee ? { reviewedFee } : {}),
          signerAccountId,
          ...(acknowledgment?.checked === true ? { untrackedVerified: true } : {}),
        })
        .then(
          async () => {
            showToast(
              mode === "confirm-and-execute"
                ? "Confirm & execute submitted"
                : "Confirmation submitted",
              "success",
            );
            closePanel(deps, panel, false);
            await deps.render(await deps.wallet.loadStatus());
          },
          (error: unknown) => {
            const failed = errorMessage(
              error,
              mode === "confirm-and-execute" ? "Confirm and execute failed" : "Confirmation failed",
            );
            status.textContent = failed;
            showToast(failed, "error");
            buttonBusy(button, false);
            setChoicesDisabled(panel, false);
            delete panel.dataset["msSubmitting"];
          },
        );
    });
  });
};
