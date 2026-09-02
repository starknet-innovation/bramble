/**
 * Binds the pure paired-phone sign controller to the DOM: it renders the handoff
 * takeover into a dedicated overlay element, wires its copy/paste/retry/cancel
 * controls to the controller, and polls the background for parked signs.
 *
 * The overlay is owned here rather than in the main paint() so the prompt
 * survives dashboard repaints — the controller's phase must not reset when
 * balances stream in, and a phone round-trip lasts long enough that they will.
 * `poll` is called from the panel's render/event cycle; when the background
 * parks a signature it broadcasts a wallet event, the panel re-polls, and the
 * first pending request takes the overlay. The rendered markup comes from the
 * escaped, logic-free {@link mobilePqSignScreen} template (no unescaped dynamic
 * text), inserted via a parsed fragment — the same trusted string-HTML sink the
 * rest of the panel uses.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { bindCopyButtons, renderFragment } from "../../shared/dom";
import {
  createMobilePqSignController,
  type MobilePqSignController,
  type MobilePqSignView,
} from "./sign-session";
import { mobilePqSignScreen } from "./sign-views";

/**
 * Collaborators the runtime binder needs: the overlay `mount` element it owns, a
 * `status` accessor for network context in the prompt, and the panel wallet
 * client for the queue round-trip.
 */
export type MobilePqSignRuntimeDeps = {
  /**
   * Carries one envelope to a phone over Bluetooth. Absent when this build has
   * no way to reach one, and the prompt then offers only the paste path.
   */
  readonly bluetooth?: (envelope: string) => Promise<string>;
  readonly mount: HTMLElement;
  readonly onSignatureReported?: () => void;
  readonly status: () => WalletStatus;
  readonly wallet: Pick<SidepanelWallet, "completeMobilePqSign" | "loadMobilePqSignPending">;
};

/**
 * The side-panel paired-phone signing runtime. `poll` fetches parked signs and
 * presents the first one; it is idempotent while a request is being fulfilled.
 */
export type MobilePqSignRuntime = {
  readonly poll: () => Promise<void>;
};

/**
 * Creates the DOM-bound paired-phone signing runtime. The controller is created
 * once and persists across polls, so a re-poll never resets an in-flight prompt
 * or discards what the user has already pasted; the overlay is cleared when no
 * request is active.
 */
export const createMobilePqSignRuntime = (deps: MobilePqSignRuntimeDeps): MobilePqSignRuntime => {
  const { mount, onSignatureReported, status, wallet } = deps;
  let controller: MobilePqSignController;

  const pastedResponse = (): string =>
    mount.querySelector<HTMLTextAreaElement>("[data-mobile-pq-response]")?.value ?? "";

  const bindControls = (): void => {
    // The overlay lives outside the app root, so the panel's own copy binding
    // never reaches it; bind the request and hash copy controls against this
    // mount instead.
    bindCopyButtons(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-submit]")
      ?.addEventListener("click", () => void controller.submit(pastedResponse()));
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-retry]")
      ?.addEventListener("click", () => controller.retry());
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-bluetooth]")
      ?.addEventListener("click", () => void controller.sendOverBluetooth());
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-use-clipboard]")
      ?.addEventListener("click", () => controller.useTransport("clipboard"));
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-use-bluetooth]")
      ?.addEventListener("click", () => controller.useTransport("bluetooth"));
    mount
      .querySelector<HTMLButtonElement>("[data-mobile-pq-cancel]")
      ?.addEventListener("click", () => void controller.cancel());
  };

  const renderOverlay = (view: MobilePqSignView | null): void => {
    if (!view) {
      mount.replaceChildren();
      mount.hidden = true;
      return;
    }
    renderFragment(mount, mobilePqSignScreen(view, status()));
    mount.hidden = false;
    bindControls();
  };

  controller = createMobilePqSignController({
    ...(deps.bluetooth === undefined ? {} : { bluetooth: deps.bluetooth }),
    render: renderOverlay,
    report: async (outcome) => {
      await wallet.completeMobilePqSign(outcome);
      if ("signature" in outcome) {
        onSignatureReported?.();
      }
    },
  });

  return {
    async poll() {
      const pending = await wallet.loadMobilePqSignPending();
      const first = pending[0];
      if (first) {
        controller.present(first);
      }
    },
  };
};
