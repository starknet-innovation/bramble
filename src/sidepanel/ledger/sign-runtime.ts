/**
 * Binds the pure Ledger sign controller to the DOM: it renders the device-prompt
 * takeover into a dedicated overlay element, wires its connect/retry/cancel
 * controls to the controller, and polls the background for parked device signs.
 *
 * The overlay is owned here rather than in the main paint() so the device prompt
 * survives dashboard repaints (the controller's phase must not reset when
 * balances stream in). `poll` is called from the panel's render/event cycle;
 * when the background parks a keyless-Ledger signature it broadcasts a wallet
 * event, the panel re-polls, and the first pending request takes the overlay.
 * Device I/O is injected via {@link LedgerConnector}, so this binder is
 * exercised under happy-dom with a fake connector and wallet. The rendered
 * markup comes from the escaped, logic-free {@link ledgerSignScreen} template
 * (no unescaped dynamic text), inserted via a parsed fragment — the same trusted
 * string-HTML sink the rest of the panel uses.
 */
import type { WalletStatus } from "../../popup/responses";
import { renderFragment } from "../dom";
import type { SidepanelWallet } from "../runtime";
import {
  createLedgerSignController,
  type LedgerConnector,
  type LedgerSignController,
  type LedgerSignView,
} from "./sign-session";
import { ledgerSignScreen } from "./sign-views";

/**
 * Collaborators the runtime binder needs: the overlay `mount` element it owns,
 * the device `connector`, a `status` accessor for network context in the prompt,
 * and the panel wallet client for the queue round-trip.
 */
export type LedgerSignRuntimeDeps = {
  readonly connector: LedgerConnector;
  readonly mount: HTMLElement;
  readonly onSignatureReported?: () => void;
  readonly status: () => WalletStatus;
  readonly wallet: Pick<SidepanelWallet, "completeLedgerSign" | "loadLedgerSignPending">;
};

/**
 * The side-panel Ledger signing runtime. `poll` fetches parked device signs and
 * presents the first one; it is idempotent while a request is being fulfilled.
 */
export type LedgerSignRuntime = {
  readonly poll: () => Promise<void>;
};

/**
 * Creates the DOM-bound Ledger signing runtime. The controller is created once
 * and persists across polls, so a re-poll never resets an in-flight device
 * prompt; the overlay is cleared when no request is active.
 */
export const createLedgerSignRuntime = (deps: LedgerSignRuntimeDeps): LedgerSignRuntime => {
  const { connector, mount, onSignatureReported, status, wallet } = deps;
  let controller: LedgerSignController;

  const bindControls = (): void => {
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-connect]")
      ?.addEventListener("click", () => controller.connect());
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-retry]")
      ?.addEventListener("click", () => controller.retry());
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-cancel]")
      ?.addEventListener("click", () => void controller.cancel());
    for (const button of mount.querySelectorAll<HTMLButtonElement>("[data-ledger-device]")) {
      button.addEventListener("click", () => {
        const deviceId = button.dataset["ledgerDevice"];
        if (deviceId) {
          controller.chooseDevice(deviceId);
        }
      });
    }
  };

  const renderOverlay = (view: LedgerSignView | null): void => {
    if (!view) {
      mount.replaceChildren();
      mount.hidden = true;
      return;
    }
    renderFragment(mount, ledgerSignScreen(view, status()));
    mount.hidden = false;
    bindControls();
  };

  controller = createLedgerSignController({
    connector,
    render: renderOverlay,
    report: async (outcome) => {
      await wallet.completeLedgerSign(outcome);
      if ("r" in outcome) {
        onSignatureReported?.();
      }
    },
  });

  return {
    async poll() {
      const pending = await wallet.loadLedgerSignPending();
      const first = pending[0];
      if (first) {
        controller.present(first);
      }
    },
  };
};
