/**
 * Binds the Ledger onboarding controller to the DOM: it owns an overlay (like
 * the sign runtime, outside the shell repaint so an in-flight enumeration is not
 * reset by streaming data), renders the chooser/connect/reading/picker/error
 * states, and wires their controls. `bindTriggers` (re-)wires the in-shell
 * "Connect a Ledger" entry each paint; `start` opens the connect overlay;
 * `startAddAccount` opens the add-account chooser. Device I/O is injected via
 * {@link LedgerConnector} and the on-chain `describe`, so the binder runs under
 * happy-dom with fakes. Markup comes from the escaped onboarding templates,
 * inserted through the audited dom.ts fragment sink.
 */
import type { AccountContractType, LedgerAccountRef } from "@bramble/wallet-model/accounts";
import type { SidepanelWallet } from "../../runtime/runtime";
import { renderFragment } from "../../shared/dom";
import {
  createLedgerOnboardController,
  enumerateLedgerPubKeys,
  LEDGER_PAGE_SIZE,
  type LedgerCandidateState,
  type LedgerOnboardAddKind,
  type LedgerOnboardController,
  type LedgerOnboardView,
} from "./onboard-session";
import {
  addAccountChooser,
  ledgerAccountPicker,
  ledgerConnectPrompt,
  ledgerDevicePicker,
  ledgerOnboardError,
  ledgerReadingPrompt,
} from "./onboard-views";
import type { LedgerConnector } from "./sign-session";

/**
 * Collaborators the onboarding binder needs: the overlay `mount` it owns, the
 * device `connector`, the active `networkId`, an `existingIds` accessor for
 * duplicate detection, a per-candidate on-chain `describe`, the `create` action
 * for a chosen account (given the whole account so its target network is
 * unambiguous even mid-batch), the HD-derive route `addHd`, the import route
 * `openImport`, the panel wallet client (for address derivation), a `refresh`
 * run after a successful add, and an `onCancel` hook run when the user dismisses
 * the overlay.
 *
 * `create` is injected rather than fixed so one runtime serves both entry points:
 * the first-run screen wires it to `createLedgerVault` (a brand-new Ledger-only
 * wallet), while the add-to-existing-wallet entry wires it to `addLedgerAccount`.
 * `onCancel` lets the first-run entry clear its captured setup secret when the
 * overlay is dismissed, so a cancelled setup leaves nothing sensitive in memory.
 */
export type LedgerOnboardRuntimeDeps = {
  readonly addHd: (accountContractType: AccountContractType) => Promise<void>;
  readonly connector: LedgerConnector;
  readonly create: (account: LedgerAccountRef) => Promise<void>;
  readonly describe: (address: string, networkId: string) => Promise<LedgerCandidateState>;
  readonly existingIds: () => ReadonlySet<string>;
  readonly mount: HTMLElement;
  readonly networkId: () => string;
  readonly onCancel: () => void;
  readonly openImport: () => void;
  readonly openMultisig: () => void;
  readonly refresh: () => Promise<void>;
  readonly wallet: Pick<SidepanelWallet, "deriveLedgerAccounts">;
};

/**
 * The Ledger onboarding runtime. `start` opens the connect prompt;
 * `startAddAccount` opens the add-account chooser; `bindTriggers` re-wires the
 * in-shell entry control after each paint.
 */
export type LedgerOnboardRuntime = {
  readonly bindTriggers: (app: Element | null) => void;
  readonly start: (accountContractType?: AccountContractType) => void;
  readonly startAddAccount: () => void;
};

const isAddKind = (value: string | undefined): value is LedgerOnboardAddKind =>
  value === "argent" ||
  value === "import" ||
  value === "ledger-argent" ||
  value === "ledger-openzeppelin" ||
  value === "multisig" ||
  value === "openzeppelin";

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

  const bindSelection = (): void => {
    for (const input of mount.querySelectorAll<HTMLInputElement>("[data-ledger-toggle]")) {
      input.addEventListener("change", () => {
        const index = Number(input.dataset["ledgerToggle"]);
        if (Number.isSafeInteger(index)) {
          controller.toggle(index);
        }
      });
    }
  };

  const bindChooser = (): void => {
    for (const button of mount.querySelectorAll<HTMLButtonElement>("[data-add-kind]")) {
      button.addEventListener("click", () => {
        const kind = button.dataset["addKind"];
        if (isAddKind(kind)) {
          controller.select(kind);
        }
      });
    }
    mount
      .querySelector<HTMLButtonElement>("[data-add-continue]")
      ?.addEventListener("click", () => controller.continueChoice());
  };

  const bindDevices = (): void => {
    for (const button of mount.querySelectorAll<HTMLButtonElement>("[data-ledger-device]")) {
      button.addEventListener("click", () => {
        const deviceId = button.dataset["ledgerDevice"];
        if (deviceId) {
          controller.chooseDevice(deviceId);
        }
      });
    }
  };

  const bindControls = (): void => {
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-onboard-connect]")
      ?.addEventListener("click", () => controller.connect());
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-onboard-cancel]")
      ?.addEventListener("click", () => controller.cancel());
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-load-more]")
      ?.addEventListener("click", () => controller.loadMore());
    mount
      .querySelector<HTMLButtonElement>("[data-ledger-add-selected]")
      ?.addEventListener("click", () => controller.addSelected());
    bindSelection();
    bindChooser();
    bindDevices();
  };

  const bodyFor = (view: LedgerOnboardView): string => {
    if (view.kind === "chooser") {
      return addAccountChooser(view.selected);
    }
    if (view.kind === "connect") {
      return ledgerConnectPrompt();
    }
    if (view.kind === "reading") {
      return ledgerReadingPrompt();
    }
    if (view.kind === "devices") {
      return ledgerDevicePicker(view.devices);
    }
    if (view.kind === "picker") {
      return ledgerAccountPicker(view.candidates, view.selected, view.message);
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
    addHd: (accountContractType) => deps.addHd(accountContractType),
    connector,
    create,
    derive: (entries, accountContractType) =>
      wallet.deriveLedgerAccounts(networkId(), entries, accountContractType),
    describe: (account) => describe(account.address, networkId()),
    enumerate: (client, startIndex, readiness) =>
      enumerateLedgerPubKeys(client, startIndex, LEDGER_PAGE_SIZE, readiness),
    existingIds,
    onCancel,
    openImport: () => deps.openImport(),
    openMultisig: () => deps.openMultisig(),
    refresh,
    render,
  });

  return {
    bindTriggers(app) {
      app
        ?.querySelector<HTMLButtonElement>("[data-connect-ledger]")
        ?.addEventListener("click", () => controller.start());
    },
    start(accountContractType) {
      controller.start(accountContractType);
    },
    startAddAccount() {
      controller.showChooser();
    },
  };
};
