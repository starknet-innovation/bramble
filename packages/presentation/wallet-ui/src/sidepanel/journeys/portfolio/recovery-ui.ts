/**
 * Binding for the read-only Home flag's recovery action (Braavos 2FA removal,
 * Ready guardian escape). Removing a second factor is consequential, so the
 * action is a review followed by an explicit confirmation: the first press
 * fetches the review and replaces the flag's body with a panel that states
 * the consequence, the timing, who can still cancel, and the maximum fee, with
 * Cancel and confirm buttons. The armed panel never outlives its review: it
 * resets on Cancel, after {@link RECOVERY_CONFIRM_TTL_MS}, and on any
 * re-render (the panel lives only in the DOM it was bound to, so an account,
 * network or view change discards it with the markup). The submit sends back
 * exactly what the panel showed; the background re-checks all of it.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { RecoveryReview } from "../../../popup/responses/responses-recovery";
import type { RefreshReason } from "../../app/sync/refresh-scheduler";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, showToast } from "../../shared/dom";
import { buildRecoveryConfirm } from "./recovery-view";

/** How long an armed confirmation stays up before it resets to the flag. */
export const RECOVERY_CONFIRM_TTL_MS = 60_000;

/** Timer seam so the expiry is testable without waiting a minute. */
export type RecoveryTimers = {
  readonly clear: (handle: ReturnType<typeof setTimeout>) => void;
  readonly set: (task: () => void, ms: number) => ReturnType<typeof setTimeout>;
};

const defaultTimers: RecoveryTimers = {
  clear: (handle) => clearTimeout(handle),
  set: (task, ms) => setTimeout(task, ms),
};

/** Collaborators the recovery binding reads; a subset of the Home deps. */
export type RecoveryUiDeps = {
  readonly app: Element | null;
  readonly render: (status: WalletStatus, refreshReason?: RefreshReason) => Promise<void>;
  readonly wallet: Pick<
    SidepanelWallet,
    | "loadStatus"
    | "recoverArgentAccount"
    | "recoverBraavosAccount"
    | "reviewArgentRecovery"
    | "reviewBraavosRecovery"
  >;
};

const submittedCopy = (kind: "argent" | "braavos", review: RecoveryReview): string =>
  kind === "braavos"
    ? "2FA removal started."
    : review.step === "complete"
      ? "Guardian removed."
      : "Guardian removal started.";

/**
 * Binds the recover-account action on the read-only Home flag. Safe to call
 * on every render; markup without the action is skipped.
 */
export const bindRecoverAccount = (
  deps: RecoveryUiDeps,
  timers: RecoveryTimers = defaultTimers,
): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("#recover-account");
  const body = button?.closest<HTMLElement>("[data-recovery-body]");
  if (!button || !body) return;
  const kind = button.dataset["recoverKind"] === "argent" ? "argent" : "braavos";
  const idle = [...body.childNodes];
  let expiry: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => {
    if (expiry !== null) timers.clear(expiry);
    expiry = null;
    body.replaceChildren(...idle);
    buttonBusy(button, false);
  };
  const submit = async (review: RecoveryReview, controls: readonly HTMLButtonElement[]) => {
    if (expiry !== null) timers.clear(expiry);
    expiry = null;
    for (const control of controls) buttonBusy(control, true);
    try {
      await (kind === "argent"
        ? deps.wallet.recoverArgentAccount(review)
        : deps.wallet.recoverBraavosAccount(review));
      showToast(submittedCopy(kind, review), "success", body);
    } catch (error) {
      showToast(errorDetails(error, "Couldn't start recovery. Try again."), "error", body);
    }
    // Whatever happened, the panel is spent: a retry starts from a new review,
    // and the forced refresh re-reads the chain's recovery state.
    disarm();
    await deps.render(await deps.wallet.loadStatus(), "action");
  };
  button.addEventListener("click", async () => {
    buttonBusy(button, true);
    let review: RecoveryReview;
    try {
      review =
        kind === "argent"
          ? await deps.wallet.reviewArgentRecovery()
          : await deps.wallet.reviewBraavosRecovery();
    } catch (error) {
      buttonBusy(button, false);
      showToast(errorDetails(error, "Couldn't review the recovery. Try again."), "error", button);
      return;
    }
    // A re-render while the review was in flight has replaced this flag; a
    // confirmation must never attach to markup that is no longer shown.
    if (!body.isConnected) return;
    const panel = buildRecoveryConfirm(body.ownerDocument, kind, review);
    body.replaceChildren(panel.panel);
    expiry = timers.set(disarm, RECOVERY_CONFIRM_TTL_MS);
    panel.cancel.addEventListener("click", disarm);
    panel.confirm.addEventListener("click", () => {
      void submit(review, [panel.cancel, panel.confirm]);
    });
    panel.confirm.focus({ preventScroll: true });
  });
};
