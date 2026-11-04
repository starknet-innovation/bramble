/**
 * The Quantum-safe Bitcoin journey: which account the backup screen is for,
 * the one account creation allowed in flight, and the binding of whichever QSB
 * screen is mounted. Created once by the side panel; it holds account ids and
 * a status sentence, never secret material.
 *
 * Every paint replaces the panel's DOM and then calls `bind`, which first
 * wipes the screen bound before it. That is what empties the backup and import
 * fields when the user leaves, when a request takes the panel over, or when
 * the wallet locks.
 */
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import type { WalletView } from "../../shared/parts";
import { bindQsbAccounts } from "./qsb-accounts";
import { bindQsbBackup, type QsbBackupTarget } from "./qsb-backup-ui";
import { bindQsbImport } from "./qsb-import-ui";
import { type QsbRoute, qsbWriteFailure } from "./qsb-model";
import type { QsbWallet } from "./qsb-runtime";

/** What the journey drives: navigation, the clock behind the check words, the client. */
export type QsbJourneyDeps = {
  /** Leaves a finished flow for the screen it was opened from. */
  readonly back: () => void;
  readonly navigate: (view: WalletView) => void;
  /** Varies the check-word positions between backups; absent asks the same three. */
  readonly now: (() => number) | null;
  readonly wallet: QsbWallet;
};

/** The journey the side panel holds. */
export type QsbJourney = {
  /** Wipes the previously bound QSB screen, then binds the one under `app`, if any. */
  readonly bind: (app: Element | null) => void;
  /** Creates an account and opens its backup, or opens the import screen. */
  readonly open: (route: QsbRoute) => void;
  /** Opens the backup of an existing account. */
  readonly openBackup: (accountId: string) => void;
};

type Session = { readonly refresh?: () => void; readonly wipe: () => void };

/**
 * Creates the journey. A second create while one is in flight only reopens
 * its progress, so a double tap can never make two accounts.
 */
export const createQsbJourney = (deps: QsbJourneyDeps): QsbJourney => {
  const { wallet } = deps;
  let target: QsbBackupTarget = { kind: "none" };
  let session: Session | null = null;
  let creating = false;

  const openBackup = (accountId: string): void => {
    target = { id: accountId, kind: "account" };
    deps.navigate("qsb-backup");
  };

  // Settles only the creation the backup screen is still waiting on: if the
  // user moved on to another account's backup, the new one waits in the list.
  const settle = (next: QsbBackupTarget): void => {
    creating = false;
    if (target.kind !== "creating") return;
    target = next;
    session?.refresh?.();
  };

  const create = (): void => {
    target = { kind: "creating" };
    if (!creating) {
      creating = true;
      void wallet.createQsbAccount().then(
        (account) => settle({ id: account.id, kind: "account" }),
        (error: unknown) =>
          settle({
            kind: "failed",
            line: qsbWriteFailure(error, QSB_ACCOUNT_REFUSALS.creationFailed),
          }),
      );
    }
    deps.navigate("qsb-backup");
  };

  const bind = (app: Element | null): void => {
    session?.wipe();
    session = null;
    const list = app?.querySelector<HTMLElement>("#qsb-accounts-list");
    if (app && list) {
      bindQsbAccounts({ create, list, openBackup, root: app, wallet });
      return;
    }
    const backup = app?.querySelector<HTMLElement>("#qsb-backup");
    if (backup) {
      session = bindQsbBackup({
        done: deps.back,
        now: deps.now,
        root: backup,
        target: () => target,
        wallet,
      });
      return;
    }
    const form = app?.querySelector<HTMLFormElement>("#qsb-import-form");
    if (form) session = bindQsbImport({ done: deps.back, form, wallet });
  };

  return {
    bind,
    open: (route) => (route === "create" ? create() : deps.navigate("qsb-import")),
    openBackup,
  };
};
