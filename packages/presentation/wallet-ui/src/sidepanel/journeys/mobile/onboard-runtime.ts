/**
 * Binds the pure enrollment controller to the DOM. The overlay is owned here
 * rather than in the main paint() so a dashboard repaint never clears a form the
 * user is part-way through pasting into — and with a clipboard transport that
 * form is open while they switch to another application.
 *
 * The rendered markup comes from the escaped, logic-free
 * {@link mobilePqEnrollScreen} template, inserted through the same parsed-fragment
 * sink the rest of the panel uses. No secret material crosses: an enrollment
 * carries a public key and a public signature.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { bindCopyButtons, renderFragment } from "../../shared/dom";
import {
  createMobilePqEnrollController,
  type MobilePqEnrollController,
  type MobilePqEnrollView,
} from "./onboard-session";
import { mobilePqEnrollScreen } from "./onboard-views";

/**
 * Collaborators the binder needs: the overlay `mount` it owns, a `status`
 * accessor for network context, the panel wallet client, the active `networkId`
 * the account is created under, and a `refresh` so the shell shows the new
 * account once it exists.
 */
export type MobilePqOnboardRuntimeDeps = {
  /**
   * Carries the pairing offer to a phone over Bluetooth. Absent when this build
   * has no way to reach one, and the journey then offers only the paste path.
   */
  readonly bluetooth?: (offer: string) => Promise<string>;
  readonly mount: HTMLElement;
  readonly networkId: () => string;
  readonly refresh: () => Promise<void>;
  readonly status: () => WalletStatus;
  readonly wallet: Pick<SidepanelWallet, "addMobilePqAccount" | "loadMobilePqEnrollChallenge">;
};

/**
 * The side-panel enrollment runtime. `open` starts a fresh enrollment; it is the
 * only entry point, because a challenge is issued per attempt.
 */
export type MobilePqOnboardRuntime = {
  readonly open: () => Promise<void>;
};

/**
 * Creates the DOM-bound enrollment runtime.
 */
export const createMobilePqOnboardRuntime = (
  deps: MobilePqOnboardRuntimeDeps,
): MobilePqOnboardRuntime => {
  const { mount, networkId, refresh, status, wallet } = deps;
  let controller: MobilePqEnrollController;

  const fieldValue = (selector: string): string =>
    mount.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value.trim() ?? "";

  const bindControls = (): void => {
    // The overlay lives outside the app root, so the panel's own copy binding
    // never reaches it; bind the challenge copy control against this mount.
    bindCopyButtons(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-enroll-submit]")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        void controller.submit(fieldValue("[data-mobile-pq-response]"));
      });
    // `preventDefault` on every one of these: the enrollment controls live
    // inside a `<form>`, so a button without it submits the form instead of
    // running its handler.
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-enroll-bluetooth]")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        void controller.sendOverBluetooth();
      });
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-enroll-use-clipboard]")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        controller.useTransport("clipboard");
      });
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-enroll-use-bluetooth]")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        controller.useTransport("bluetooth");
      });
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-enroll-cancel]")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        controller.cancel();
      });
  };

  const renderOverlay = (view: MobilePqEnrollView | null): void => {
    if (!view) {
      mount.replaceChildren();
      mount.hidden = true;
      return;
    }
    renderFragment(mount, mobilePqEnrollScreen(view, status()));
    mount.hidden = false;
    bindControls();
  };

  controller = createMobilePqEnrollController({
    ...(deps.bluetooth === undefined ? {} : { bluetooth: deps.bluetooth }),
    challenge: () => wallet.loadMobilePqEnrollChallenge(),
    enroll: async (draft) => {
      await wallet.addMobilePqAccount({ ...draft, networkId: networkId() });
    },
    networkId,
    onEnrolled: refresh,
    render: renderOverlay,
  });

  return {
    open: () => controller.open(),
  };
};
