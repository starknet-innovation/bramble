/**
 * Binds the Ledger onboarding controller to the DOM: it owns an overlay (like
 * the sign runtime, outside the shell repaint so an in-flight enumeration is not
 * reset by streaming data), renders the connect/reading/picker/error states, and
 * wires their controls. `bindTriggers` (re-)wires the in-shell "Connect a Ledger"
 * entry each paint; `start` opens the overlay. Device I/O is injected via
 * {@link LedgerConnector} and the on-chain `describe`, so the binder runs under
 * happy-dom with fakes. Markup comes from the escaped onboarding templates,
 * inserted through the audited dom.ts fragment sink.
 */
import { renderFragment } from "../dom";
import type { SidepanelWallet } from "../runtime";
import {
  createLedgerOnboardController,
  enumerateLedgerPubKeys,
  type LedgerCandidateState,
  type LedgerOnboardController,
  type LedgerOnboardView,
} from "./onboard-session";
import {
  ledgerAccountPicker,
  ledgerConnectPrompt,
  ledgerOnboardError,
  ledgerReadingPrompt,
} from "./onboard-views";
import type { LedgerConnector } from "./sign-session";

/**
 * Collaborators the onboarding binder needs: the overlay `mount` it owns, the
 * device `connector`, the active `networkId`, an `existingIds` accessor for
 * duplicate detection, a per-candidate on-chain `describe`, the `create` action
 * for the chosen account, the panel wallet client (for address derivation), a
 * `refresh` run after a successful add, and an `onCancel` hook run when the user
 * dismisses the overlay.
 *
 * `create` is injected rather than fixed so one runtime serves both entry points:
 * the first-run screen wires it to `createLedgerVault` (a brand-new Ledger-only
 * wallet), while the add-to-existing-wallet entry wires it to `addLedgerAccount`.
 * `onCancel` lets the first-run entry clear its captured setup secret when the
 * overlay is dismissed, so a cancelled setup leaves nothing sensitive in memory.
 */
export type LedgerOnboardRuntimeDeps = {
  readonly connector: LedgerConnector;
  readonly create: (accountIndex: number, publicKeyX: string) => Promise<void>;
  readonly describe: (address: string, networkId: string) => Promise<LedgerCandidateState>;
  readonly existingIds: () => ReadonlySet<string>;
  readonly mount: HTMLElement;
  readonly networkId: () => string;
  readonly onCancel: () => void;
  readonly refresh: () => Promise<void>;
  readonly wallet: Pick<SidepanelWallet, "deriveLedgerAccounts">;
};

/**
 * The Ledger onboarding runtime. `start` opens the connect prompt; `bindTriggers`
 * re-wires the in-shell entry control after each paint.
 */
export type LedgerOnboardRuntime = {
  readonly bindTriggers: (app: Element | null) => void;
  readonly start: () => void;
};

/**
 * Creates the DOM-bound Ledger onboarding runtime. The controller persists
 * across paints so a mid-flow repaint never resets the picker; the overlay is
 * cleared when the flow ends.
 */
export const createLedgerOnboardRuntime = (
  deps: LedgerOnboardRuntimeDeps,
): LedgerOnboardRuntime => {
  const { connector, create, describe, existingIds, mount, networkId, onCancel, refresh, wallet } =
    deps;
  let controller: LedgerOnboardController;

  const bindControls = (): void => {
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-onboard-connect]")
      ?.addEventListener("click", () => controller.connect());
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-onboard-cancel]")
      ?.addEventListener("click", () => controller.cancel());
    for (const button of mount.querySelectorAll<HTMLButtonElement>("[data-ledger-select]")) {
      button.addEventListener("click", () => {
        const index = Number(button.dataset["ledgerSelect"]);
        if (Number.isSafeInteger(index)) {
          controller.select(index);
        }
      });
    }
  };

  const bodyFor = (view: LedgerOnboardView): string => {
    if (view.kind === "connect") {
      return ledgerConnectPrompt();
    }
    if (view.kind === "reading") {
      return ledgerReadingPrompt();
    }
    if (view.kind === "picker") {
      return ledgerAccountPicker(view.candidates);
    }
    return ledgerOnboardError(view.message);
  };

  const render = (view: LedgerOnboardView | null): void => {
    if (!view) {
      mount.replaceChildren();
      mount.hidden = true;
      return;
    }
    renderFragment(mount, bodyFor(view));
    mount.hidden = false;
    bindControls();
  };

  controller = createLedgerOnboardController({
    connector,
    create,
    derive: (entries) => wallet.deriveLedgerAccounts(networkId(), entries),
    describe: (account) => describe(account.address, networkId()),
    enumerate: (client) => enumerateLedgerPubKeys(client),
    existingIds,
    onCancel,
    refresh,
    render,
  });

  return {
    bindTriggers(app) {
      app
        ?.querySelector<HTMLButtonElement>("[data-connect-ledger]")
        ?.addEventListener("click", () => controller.start());
    },
    start() {
      controller.start();
    },
  };
};
