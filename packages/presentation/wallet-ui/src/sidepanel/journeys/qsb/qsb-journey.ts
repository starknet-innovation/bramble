/**
 * The Quantum-safe Bitcoin journey: which account the backup and account
 * screens are for, which vault the deposit screen is for, the one account
 * creation allowed in flight, the vault writes allowed in flight (one
 * creation per account, one deposit or resend per vault), and the binding of
 * whichever QSB screen is mounted. Created once by the side panel; it holds
 * account ids, vault indices and a status sentence, never secret material.
 *
 * Every paint replaces the panel's DOM and then calls `bind`, which first
 * wipes the screen bound before it. That is what empties the backup, import
 * and deposit fields, stops the account screen's poll, and drops replies still
 * in flight when the user leaves, when a request takes the panel over, or when
 * the wallet locks.
 */
import { QSB_ACCOUNT_REFUSALS } from "@bramble/wallet-model/qsb";
import type { HostPermissionApi } from "../../runtime/runtime-global";
import type { WalletView } from "../../shared/parts";
import { platformTimers, type StageTimers } from "../../shared/stage-pacer";
import { createQsbAccess } from "./qsb-access";
import { bindQsbAccount } from "./qsb-account-ui";
import { bindQsbAccounts } from "./qsb-accounts";
import { bindQsbBackup, type QsbBackupTarget } from "./qsb-backup-ui";
import { bindQsbDeposit, type QsbDepositTarget } from "./qsb-deposit-ui";
import { bindQsbImport } from "./qsb-import-ui";
import { type QsbRoute, qsbWriteFailure } from "./qsb-model";
import type { QsbWallet } from "./qsb-runtime";
import type { QsbVaultWallet } from "./qsb-vault-runtime";
import { createQsbVaultWrites } from "./qsb-vault-writes";

/** The QSB account and vault clients the journey drives. */
export type QsbJourneyWallet = QsbWallet & QsbVaultWallet;

/** What the journey drives: navigation, the clock behind the check words, the client. */
export type QsbJourneyDeps = {
  /** Leaves a finished flow for the screen it was opened from. */
  readonly back: () => void;
  readonly navigate: (view: WalletView) => void;
  /** Varies the check-word positions between backups; absent asks the same three. */
  readonly now: (() => number) | null;
  /**
   * Checks and asks for the coordinator origin. Null (no browser API) reads as
   * never granted, so no coordinator write is ever sent.
   */
  readonly permissions: HostPermissionApi | null;
  /** Schedules the account screen's poll; the platform timers when absent. */
  readonly timers?: StageTimers;
  readonly wallet: QsbJourneyWallet;
};

/** The journey the side panel holds. */
export type QsbJourney = {
  /** Wipes the previously bound QSB screen, then binds the one under `app`, if any. */
  readonly bind: (app: Element | null) => void;
  /** Creates an account and opens its backup, or opens the import screen. */
  readonly open: (route: QsbRoute) => void;
  /** Opens one account's address, balance and vaults. */
  readonly openAccount: (accountId: string) => void;
  /** Opens the backup of an existing account. */
  readonly openBackup: (accountId: string) => void;
  /** Opens the deposit into vault `v` of an account; the account screen's Deposit does this. */
  readonly openDeposit: (accountId: string, v: number) => void;
};

type Session = { readonly refresh?: () => void; readonly wipe: () => void };

/**
 * Creates the journey. A second create while one is in flight only reopens
 * its progress, so a double tap can never make two accounts; vault writes are
 * guarded the same way by {@link createQsbVaultWrites}.
 */
export const createQsbJourney = (deps: QsbJourneyDeps): QsbJourney => {
  const { wallet } = deps;
  const timers = deps.timers ?? platformTimers;
  const writes = createQsbVaultWrites(wallet);
  const access = createQsbAccess(deps.permissions);
  let target: QsbBackupTarget = { kind: "none" };
  let account: string | null = null;
  let deposit: QsbDepositTarget | null = null;
  let session: Session | null = null;
  let creating = false;

  const openBackup = (accountId: string): void => {
    target = { id: accountId, kind: "account" };
    deps.navigate("qsb-backup");
  };
  const openAccount = (accountId: string): void => {
    account = accountId;
    deps.navigate("qsb-account");
  };
  const openDeposit = (accountId: string, v: number): void => {
    deposit = { accountId, v };
    deps.navigate("qsb-deposit");
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
        (created) => settle({ id: created.id, kind: "account" }),
        (error: unknown) =>
          settle({
            kind: "failed",
            line: qsbWriteFailure(error, QSB_ACCOUNT_REFUSALS.creationFailed),
          }),
      );
    }
    deps.navigate("qsb-backup");
  };

  const bindScreen = (app: Element): Session | null => {
    const list = app.querySelector<HTMLElement>("#qsb-accounts-list");
    if (list) {
      bindQsbAccounts({ create, list, openAccount, openBackup, root: app, wallet });
      return null;
    }
    const detail = app.querySelector<HTMLElement>("#qsb-account");
    if (detail) {
      return bindQsbAccount({
        access,
        accountId: () => account,
        openDeposit,
        root: detail,
        timers,
        wallet,
        writes,
      });
    }
    const depositRoot = app.querySelector<HTMLElement>("#qsb-deposit");
    if (depositRoot) {
      return bindQsbDeposit({
        access,
        back: deps.back,
        root: depositRoot,
        target: () => deposit,
        wallet,
        writes,
      });
    }
    const backup = app.querySelector<HTMLElement>("#qsb-backup");
    if (backup) {
      return bindQsbBackup({
        done: deps.back,
        now: deps.now,
        root: backup,
        target: () => target,
        wallet,
      });
    }
    const form = app.querySelector<HTMLFormElement>("#qsb-import-form");
    return form ? bindQsbImport({ done: deps.back, form, wallet }) : null;
  };

  return {
    bind: (app) => {
      session?.wipe();
      session = app ? bindScreen(app) : null;
    },
    open: (route) => (route === "create" ? create() : deps.navigate("qsb-import")),
    openAccount,
    openBackup,
    openDeposit,
  };
};
