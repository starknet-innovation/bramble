/**
 * "An update is ready" (mc-wallet 708). The background applies a downloaded
 * update by itself once nothing is in use; while the wallet is open this
 * banner offers the restart instead. It lives outside the re-rendered app root
 * so a refresh never removes it, and it never restarts while a request is in
 * progress: the background refuses, and the banner says what to do.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { t } from "../../i18n/messages";
import { buttonBusy, showToast } from "../shared/dom";

/** Banner title. */
export const updateReadyTitle = (): string => t("shell.update.title");

/** Banner body: the one consequence of restarting. */
export const updateReadyBody = (): string => t("shell.update.body");

/** The restart control. */
export const updateRestartLabel = (): string => t("shell.update.restart");

/** Shown when the restart waits for a request still in progress. */
export const updateBusyNotice = (): string => t("shell.update.busy");

const BANNER_ID = "update-banner";
const CHECK_INTERVAL_MS = 60_000;

type Send = (message: unknown) => Promise<unknown>;

const okWith = (response: unknown, key: string): boolean | null =>
  isRecord(response) &&
  hasOnlyKnownKeys(response, ["ok", key]) &&
  response["ok"] === true &&
  typeof response[key] === "boolean"
    ? (response[key] as boolean)
    : null;

/**
 * The panel's update client. `updateReady` resolves whether a downloaded update
 * is waiting (false on any unexpected answer); `applyUpdate` resolves
 * "restarting", "none" when nothing is waiting, or "busy" when the background
 * refused because something is in progress.
 */
export const createUpdateClient = (sendMessage: Send) => ({
  async updateReady(): Promise<boolean> {
    return okWith(await sendMessage({ type: "wallet.updateStatus" }), "updateReady") ?? false;
  },
  async applyUpdate(): Promise<"busy" | "none" | "restarting"> {
    const restarting = okWith(await sendMessage({ type: "wallet.applyUpdate" }), "restarting");
    return restarting === null ? "busy" : restarting ? "restarting" : "none";
  },
});

/** What the banner needs from the panel. */
export type UpdateBannerDeps = {
  readonly doc: Document;
  readonly schedule?: (tick: () => void, intervalMs: number) => void;
  readonly wallet: ReturnType<typeof createUpdateClient>;
};

const defaultSchedule = (tick: () => void, intervalMs: number): void => {
  setInterval(tick, intervalMs);
};

/**
 * Checks for a waiting update now and every minute while the panel is visible,
 * and shows the banner once one is. A failed check shows nothing.
 */
export const startUpdateBanner = ({
  doc,
  schedule = defaultSchedule,
  wallet,
}: UpdateBannerDeps): void => {
  const show = (): void => {
    if (doc.getElementById(BANNER_ID)) return;
    // Built with DOM calls and text only: the shared callout's classes, no
    // string HTML, so this module needs no HTML-sink exemption.
    const holder = doc.createElement("section");
    holder.id = BANNER_ID;
    holder.className = "callout";
    holder.setAttribute("role", "status");
    const copy = doc.createElement("span");
    copy.className = "callout-copy";
    const title = doc.createElement("strong");
    title.textContent = updateReadyTitle();
    const body = doc.createElement("p");
    body.textContent = updateReadyBody();
    copy.append(title, body);
    const restart = doc.createElement("button");
    restart.id = "update-restart";
    restart.type = "button";
    restart.textContent = updateRestartLabel();
    holder.append(copy, restart);
    doc.body.prepend(holder);
    const control = holder.querySelector<HTMLButtonElement>("#update-restart");
    control?.addEventListener("click", () => {
      buttonBusy(control, true);
      void wallet.applyUpdate().then(
        (outcome) => {
          if (outcome !== "restarting") {
            if (outcome === "busy") showToast(updateBusyNotice(), "warning", control);
            buttonBusy(control, false);
          }
        },
        () => {
          showToast(updateBusyNotice(), "warning", control);
          buttonBusy(control, false);
        },
      );
    });
  };
  const check = (): void => {
    if (doc.visibilityState !== "visible") return;
    void wallet.updateReady().then(
      (ready) => {
        if (ready) show();
      },
      () => undefined,
    );
  };
  check();
  schedule(check, CHECK_INTERVAL_MS);
};
