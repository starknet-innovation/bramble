/**
 * "Unlock private transactions" (mc-wallet 668). Private actions on an
 * account pause while an earlier private transaction's outcome is unknown,
 * because proving over it could double a send. When no check can settle it,
 * this screen lets the user clear that pause on purpose, after stating that the
 * earlier transaction could still go through.
 */
import { callout } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { t, th } from "../../../i18n/messages";
import type { WalletStatus } from "../../../popup/responses/responses";
import { buttonBusy, errorDetails, showToast } from "../../shared/dom";
import { flowHeader, flowScreen } from "../../shared/parts";

/** Menu label and screen title, in the active language. */
export const privacyUnlockTitle = (): string => t("settings.privacyUnlock.title");

/** Shown once a pause was cleared, in the active language. */
export const privacyUnlockDone = (): string => t("settings.privacyUnlock.done");

/** Shown when nothing was paused, in the active language. */
export const privacyUnlockNone = (): string => t("settings.privacyUnlock.none");

/**
 * Renders the unlock screen: what is paused, the risk of clearing it, and the
 * one control that does.
 */
export const privacyUnlockFlow = (status: WalletStatus): string =>
  flowHeader(privacyUnlockTitle(), status) +
  flowScreen(
    "privacy-unlock",
    `<section class="section stack">
      <p>${th("settings.privacyUnlock.body")}</p>
      ${callout({
        body: t("settings.privacyUnlock.risk"),
        icon: "alert",
        role: "alert",
        title: t("settings.privacyUnlock.riskTitle"),
      })}
      ${button({
        attributes: { id: "privacy-unlock-confirm" },
        label: t("settings.privacyUnlock.confirm"),
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
        if (result) result.textContent = released ? privacyUnlockDone() : privacyUnlockNone();
        buttonBusy(control, false);
      },
      (error: unknown) => {
        showToast(errorDetails(error, t("settings.privacyUnlock.failed")), "error", control);
        buttonBusy(control, false);
      },
    );
  });
};
