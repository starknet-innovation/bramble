/**
 * "Unlock private transactions" (mc-wallet 668). Private actions on an
 * account pause while an earlier private transaction's outcome is unknown,
 * because proving over it could double a send. When no check can settle it,
 * this screen lets the user clear that pause on purpose, after stating that the
 * earlier transaction could still go through.
 */
import { callout } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import type { WalletStatus } from "../../../popup/responses/responses";
import { buttonBusy, errorDetails, showToast } from "../../shared/dom";
import { flowHeader, flowScreen } from "../../shared/parts";

/** Menu label and screen title. */
export const PRIVACY_UNLOCK_TITLE = "Unlock private transactions";

/** Shown once a pause was cleared. */
export const PRIVACY_UNLOCK_DONE = "Unlocked. Check Activity before you send again.";

/** Shown when nothing was paused. */
export const PRIVACY_UNLOCK_NONE = "Nothing to unlock.";

/**
 * Renders the unlock screen: what is paused, the risk of clearing it, and the
 * one control that does.
 */
export const privacyUnlockFlow = (status: WalletStatus): string =>
  flowHeader(PRIVACY_UNLOCK_TITLE, status) +
  flowScreen(
    "privacy-unlock",
    `<section class="section stack">
      <p>Private transactions from this account pause while an earlier one may still be in progress.</p>
      ${callout({
        body: "That earlier transaction could still go through. If you send again, both could complete.",
        icon: "alert",
        role: "alert",
        title: "Unlocking does not cancel it",
      })}
      ${button({
        attributes: { id: "privacy-unlock-confirm" },
        label: "Unlock anyway",
        tone: "danger",
      })}
    </section>
    <p id="privacy-unlock-result" role="status"></p>`,
  );

/** The wallet call the unlock control makes. */
export type PrivacyUnlockDeps = {
  readonly app: Element | null;
  readonly wallet: { readonly releasePendingPrivateWrite: () => Promise<boolean> };
};

/**
 * Binds the unlock control. It sends one release and reports whether a pause
 * was cleared; a failure is shown as reviewed copy and leaves the pause.
 */
export const bindPrivacyUnlock = (deps: PrivacyUnlockDeps): void => {
  const control = deps.app?.querySelector<HTMLButtonElement>("#privacy-unlock-confirm");
  const result = deps.app?.querySelector<HTMLElement>("#privacy-unlock-result");
  control?.addEventListener("click", () => {
    buttonBusy(control, true);
    void deps.wallet.releasePendingPrivateWrite().then(
      (released) => {
        if (result) result.textContent = released ? PRIVACY_UNLOCK_DONE : PRIVACY_UNLOCK_NONE;
        buttonBusy(control, false);
      },
      (error: unknown) => {
        showToast(errorDetails(error, "Private unlock failed"), "error", control);
        buttonBusy(control, false);
      },
    );
  });
};
