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
import type { WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { bindCopyButtons, isPopupSurface, renderFragment } from "../../shared/dom";
import { createStagePacer, type StageTimers } from "../../shared/stage-pacer";
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
  /** Timer seam for the takeover's stage pacing; platform timers when absent. */
  readonly timers?: StageTimers;
  readonly wallet: Pick<SidepanelWallet, "completeLedgerSign" | "loadLedgerSignPending">;
};

// Phases that wait on the reader rather than the device: painted as soon as the
// steps queued ahead of them have been read, and not held themselves.
const READER_PHASES: ReadonlySet<LedgerSignView["phase"]["kind"]> = new Set([
  "connect",
  "devices",
  "error",
]);

const sameLedgerStage = (a: LedgerSignView | null, b: LedgerSignView | null): boolean =>
  a === null || b === null
    ? a === b
    : a.request.id === b.request.id && a.phase.kind === b.phase.kind;

/**
 * The side-panel Ledger signing runtime. `poll` fetches parked device signs and
 * presents the first one; it is idempotent while a request is being fulfilled,
 * and it takes the overlay down when the presented request is no longer parked.
 * `dismiss` takes it down without a round-trip, for a panel that is locking.
 */
export type LedgerSignRuntime = {
  readonly dismiss: () => void;
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
    // The overlay lives outside the app root, so the panel's own copy binding
    // never reaches it; bind the hash-copy control against this mount instead.
    bindCopyButtons(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-connect]")
      ?.addEventListener("click", () => controller.connect());
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-retry]")
      ?.addEventListener("click", () => controller.retry());
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-cancel]")
      ?.addEventListener("click", () => void controller.cancel());
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-close]")
      ?.addEventListener("click", () => controller.close());
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

  // The controller reports each device phase the moment it starts; on a granted,
  // unlocked device the first three are over in milliseconds. The pacer holds
  // each painted step long enough to read without holding the device work, and
  // takes the overlay down at once on a cancel or dismissal. Only the close
  // after a reported signature waits, behind the "Finish" step it follows.
  const pacer = createStagePacer<LedgerSignView | null>({
    render: renderOverlay,
    sameStage: sameLedgerStage,
    ...(deps.timers ? { timers: deps.timers } : {}),
  });
  let offered: LedgerSignView | null = null;
  const pacedRender = (view: LedgerSignView | null): void => {
    const previous = offered;
    offered = view;
    if (view === null) {
      if (previous?.phase.kind === "submitting") pacer.settle(null);
      else pacer.cut(null);
      return;
    }
    if (READER_PHASES.has(view.phase.kind)) pacer.settle(view);
    else pacer.stage(view);
  };

  controller = createLedgerSignController({
    connector,
    render: pacedRender,
    report: async (outcome) => {
      await wallet.completeLedgerSign(outcome);
      if ("r" in outcome) {
        onSignatureReported?.();
      }
    },
  });

  let repollArmed = false;

  const poll = async (): Promise<void> => {
    // A toolbar popup closes as soon as the device chooser's tab takes
    // focus, orphaning the grant tab with the device still claimed (Sherlock
    // 227). The parked request stays queued for the side panel instead.
    if (isPopupSurface(mount)) {
      return;
    }
    const pending = await wallet.loadLedgerSignPending();
    // The overlay survives repaints, so its lifetime must follow the queue's:
    // a lock or the queue's timeout settles a parked request in the
    // background, and the prompt must not keep showing its hash (Sherlock 228).
    const active = controller.activeId();
    if (active !== null && !pending.some((request) => request.id === active)) {
      controller.dismiss();
    }
    // A request closed after an unfinished signature is not offered again.
    const first = pending.find((request) => !controller.closed(request.id));
    if (first) {
      controller.present(first);
      // A dismissed request's device operation may still be closing its
      // transport, so the controller skipped this one. Nothing else re-polls
      // when it finishes, so offer the queue again once it has.
      if (controller.activeId() === null && !repollArmed) {
        repollArmed = true;
        void controller
          .whenIdle()
          .then(() => {
            repollArmed = false;
            return poll();
          })
          // Best effort, like the render cycle's own poll: the next wallet
          // event polls again.
          .catch(() => undefined);
      }
    }
  };

  return {
    dismiss: () => controller.dismiss(),
    poll,
  };
};
