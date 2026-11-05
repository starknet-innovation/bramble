/**
 * One QSB account, opened from the accounts list: its owner
 * address with a guarded copy, its confirmed balance, its vaults with their
 * deposit state, New vault for a writer, and Resend for a deposit that is
 * still waiting. It reads `wallet.qsbAccounts` and `wallet.qsbVaults` when it
 * opens and on Refresh, and re-reads the vaults about once a minute while a
 * deposit is on its way and the panel is visible.
 *
 * The copy control copies only the address the client validated, set as the
 * reading arrives and cleared on `wipe`; until then it is disabled. Vault
 * writes go through the journey's single-flight guard, so this screen only
 * starts one or reattaches to the one already running. `wipe` stops the poll
 * and drops every reply still in flight; the journey calls it whenever this
 * screen is left or repainted.
 *
 * The coordinator origin is granted at runtime. Until it is, the balance gives
 * way to Allow access, and New deposit, Fund, Withdraw, Review and both
 * Resends ask for it in their own click before going on; a denial sends
 * nothing. A withdrawal's searching, sending or unconfirmed state keeps the
 * poll running as a deposit's does.
 */
import { QSB_ACCOUNT_REFUSALS, type QsbAccountView } from "@bramble/wallet-model/qsb";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { friendlyError } from "../../runtime/friendly-error";
import { bindCopyButtons, buttonBusy, errorLine, renderFragment } from "../../shared/dom";
import type { StageTimers } from "../../shared/stage-pacer";
import { isQsbAccessNeeded, type QsbAccess, withQsbAccess } from "./qsb-access";
import {
  type QsbAccountStep,
  qsbBalanceMarkup,
  qsbVaultActionMarkup,
  qsbVaultRows,
} from "./qsb-account-view";
import { qsbAccountLabel, qsbWriteFailure } from "./qsb-model";
import type { QsbWallet } from "./qsb-runtime";
import { qsbDepositInFlight, qsbNoVaultLine, qsbSubmissionLine } from "./qsb-vault-model";
import { createQsbVaultPoll } from "./qsb-vault-poll";
import {
  isQsbVaultIndex,
  type QsbDepositResult,
  type QsbVaultsReading,
  type QsbVaultWallet,
} from "./qsb-vault-runtime";
import type { QsbVaultWrites } from "./qsb-vault-writes";
import { qsbWithdrawalInFlight, qsbWithdrawalLine } from "./qsb-withdrawal-model";
import type { QsbWithdrawalResult } from "./qsb-withdrawal-runtime";

/** What the account binding needs. `accountId` is read live, never copied. */
export type QsbAccountDeps = {
  readonly access: QsbAccess;
  readonly accountId: () => string | null;
  /** The screen's title, renamed "QSB vault <n>" for the one open; skipped when absent. */
  readonly heading: HTMLElement | null;
  readonly openDeposit: (accountId: string, v: number) => void;
  /** Opens the release review of deposit `v`'s found withdrawal. */
  readonly openRelease: (accountId: string, v: number) => void;
  /** Opens the Withdraw flow for funded deposit `v`. */
  readonly openWithdraw: (accountId: string, v: number) => void;
  readonly root: HTMLElement;
  readonly timers: StageTimers;
  readonly wallet: Pick<QsbWallet, "loadQsbAccounts"> & Pick<QsbVaultWallet, "loadQsbVaults">;
  readonly writes: QsbVaultWrites;
};

/** The bound screen; `wipe` stops the poll and drops replies in flight. */
export type QsbAccountSession = { readonly wipe: () => void };

const withVault = (reading: QsbVaultsReading, vault: QsbVaultView): QsbVaultsReading => ({
  ...reading,
  vaults: [...reading.vaults.filter((entry) => entry.v !== vault.v), vault].sort(
    (a, b) => a.v - b.v,
  ),
});

/**
 * Binds the account screen under `root` and loads it. Missing controls are
 * skipped. A failed first read shows its reviewed line with Try again; a
 * failed later read keeps what is on screen and says why.
 */
export const bindQsbAccount = (deps: QsbAccountDeps): QsbAccountSession => {
  const { access, root, wallet, writes } = deps;
  const find = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);
  const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-qsb-account-step]"));
  const address = find<HTMLElement>("#qsb-address");
  const copy = find<HTMLButtonElement>("#qsb-address-copy");
  const balance = find<HTMLElement>("#qsb-balance");
  const vaultList = find<HTMLElement>("#qsb-vaults");
  const result = find<HTMLElement>("#qsb-vault-result");
  const action = find<HTMLElement>("#qsb-vault-action");
  const refresh = find<HTMLButtonElement>("#qsb-account-refresh");
  // Bumped by `wipe`: a write answered after it belongs to a screen the user left.
  let generation = 0;
  // Bumped by every read and by `wipe`: only the latest read is applied.
  let ticket = 0;
  let account: QsbAccountView | null = null;
  let reading: QsbVaultsReading | null = null;
  let confirming = false;
  let notice = "";
  // The coordinator grant as last checked or answered; false until checked.
  let accessHeld = false;
  // Writes this screen already waits on, so a repaint never attaches twice.
  const attached = new Set<string>();
  // Last markup written per region: a poll that changes nothing moves no focus.
  const painted = new Map<Element, string>();

  const show = (step: QsbAccountStep): void => {
    for (const section of steps) section.hidden = section.dataset["qsbAccountStep"] !== step;
  };
  // Writes `markup` into `target` unless it is already there; returns whether
  // it wrote, so listeners are bound once per rendered control.
  const region = (target: Element | null, markup: string): boolean => {
    if (!target || painted.get(target) === markup) return false;
    painted.set(target, markup);
    renderFragment(target, markup);
    return true;
  };
  const clearAddress = (): void => {
    if (address) address.textContent = "";
    if (copy) {
      copy.disabled = true;
      // Empty, not removed: the shared copy binding reads it at click time and
      // copies nothing while it is empty.
      copy.dataset["copy"] = "";
    }
  };
  const unavailable = (line: string, retry: boolean): void => {
    clearAddress();
    const error = find<HTMLElement>("#qsb-account-error");
    if (error) error.textContent = line;
    const again = find<HTMLButtonElement>("#qsb-account-retry");
    if (again) again.hidden = !retry;
    show("unavailable");
  };
  // Starts a read; `apply` runs only if no later read or wipe superseded it.
  // Only a read the user asked for marks Refresh busy.
  const read = <T>(
    run: Promise<T>,
    apply: (value: T) => void,
    fail: (error: unknown) => void,
    asked = true,
  ): Promise<void> => {
    const mine = ++ticket;
    if (asked) buttonBusy(refresh, true);
    return run.then(
      (value) => {
        if (mine !== ticket) return;
        buttonBusy(refresh, false);
        apply(value);
      },
      (error: unknown) => {
        if (mine !== ticket) return;
        buttonBusy(refresh, false);
        fail(error);
      },
    );
  };

  // The quiet re-read while a deposit is in flight: the vaults only, and a
  // failure keeps what is on screen (the next tick, or Refresh, reads again).
  const poll = createQsbVaultPoll({
    doc: root.ownerDocument,
    read: async () => {
      const id = deps.accountId();
      if (id === null || reading === null) return;
      await read(
        Promise.all([wallet.loadQsbVaults(id), access.check()]),
        ([next, held]) => {
          reading = next;
          accessHeld = held;
          paint();
        },
        () => undefined,
        false,
      );
    },
    timers: deps.timers,
  });

  // Sends `send` once the grant is held, asking in this click when it is not.
  // A grant re-reads the account once the write settles, since its funds were
  // unknown without it; a refusal for want of the grant marks it missing.
  const guarded = <T>(send: () => Promise<T>): Promise<T> => {
    const asking = !accessHeld;
    const attempt = generation;
    const flight = withQsbAccess(access, accessHeld, () => {
      accessHeld = true;
      const sent = send();
      paint();
      return sent;
    });
    flight.then(
      () => {
        if (asking && attempt === generation) load();
      },
      (error: unknown) => {
        if (attempt !== generation) return;
        if (isQsbAccessNeeded(error)) {
          accessHeld = false;
          paint();
        } else if (asking) {
          load();
        }
      },
    );
    return flight;
  };

  const attachCreate = (flight: Promise<QsbVaultView>): void => {
    if (attached.has("create")) return;
    attached.add("create");
    const attempt = generation;
    const settle = (next: () => void): void => {
      attached.delete("create");
      if (attempt !== generation) return;
      confirming = false;
      next();
    };
    flight.then(
      (vault) =>
        settle(() => {
          if (reading === null) return load();
          reading = withVault(reading, vault);
          notice = "";
          paint();
        }),
      (error: unknown) =>
        settle(() => {
          notice = qsbWriteFailure(error, "wallet request failed");
          paint();
        }),
    );
  };

  const attachDeposit = (v: number, flight: Promise<QsbDepositResult>): void => {
    const key = `vault:${v}`;
    if (attached.has(key)) return;
    attached.add(key);
    const attempt = generation;
    flight.then(
      ({ submission, vault }) => {
        attached.delete(key);
        if (attempt !== generation || reading === null) return;
        reading = withVault(reading, vault);
        notice = qsbSubmissionLine(submission);
        paint();
      },
      (error: unknown) => {
        attached.delete(key);
        if (attempt !== generation) return;
        notice = qsbWriteFailure(error, "wallet request failed");
        paint();
      },
    );
  };

  const attachWithdrawal = (v: number, flight: Promise<QsbWithdrawalResult>): void => {
    const key = `withdrawal:${v}`;
    if (attached.has(key)) return;
    attached.add(key);
    const attempt = generation;
    flight.then(
      ({ submission, vault }) => {
        attached.delete(key);
        if (attempt !== generation || reading === null) return;
        reading = withVault(reading, vault);
        notice = qsbWithdrawalLine(submission);
        paint();
      },
      (error: unknown) => {
        attached.delete(key);
        if (attempt !== generation) return;
        notice = qsbWriteFailure(error, "wallet request failed");
        paint();
      },
    );
  };

  // A row action that opens another screen needing the grant: opens it at
  // once when held, otherwise asks in this click and opens it only once granted.
  const openGranted = (open: () => void): void => {
    if (accessHeld) {
      open();
      return;
    }
    const attempt = generation;
    void access.request().then((granted) => {
      if (attempt !== generation) return;
      accessHeld = granted;
      if (granted) return open();
      notice = friendlyError(QSB_VAULT_REFUSALS.accessNeeded).message;
      paint();
    });
  };

  // Each control under `list` carrying `attribute`, with its validated index.
  const rowControls = (list: Element, attribute: string, bind: (v: number) => () => void) => {
    for (const control of list.querySelectorAll<HTMLButtonElement>(`[${attribute}]`)) {
      const v = Number(control.getAttribute(attribute));
      if (isQsbVaultIndex(v)) control.addEventListener("click", bind(v));
    }
  };

  const bindRows = (list: Element, id: string): void => {
    rowControls(list, "data-qsb-deposit", (v) => () => openGranted(() => deps.openDeposit(id, v)));
    rowControls(
      list,
      "data-qsb-withdraw",
      (v) => () => openGranted(() => deps.openWithdraw(id, v)),
    );
    rowControls(list, "data-qsb-review", (v) => () => openGranted(() => deps.openRelease(id, v)));
    rowControls(list, "data-qsb-resend-withdrawal", (v) => () => {
      notice = "";
      attachWithdrawal(
        v,
        guarded(() => writes.resendWithdrawal(id, v)),
      );
      paint();
    });
    for (const control of list.querySelectorAll<HTMLButtonElement>("[data-qsb-resend]")) {
      const v = Number(control.dataset["qsbResend"]);
      if (!isQsbVaultIndex(v)) continue;
      control.addEventListener("click", () => {
        notice = "";
        attachDeposit(
          v,
          guarded(() => writes.resend(id, v)),
        );
        paint();
      });
    }
  };

  const paint = (): void => {
    const id = deps.accountId();
    if (id === null || account === null || reading === null) return;
    const current = reading;
    if (address) address.textContent = current.address;
    if (copy) {
      copy.dataset["copy"] = current.address;
      copy.disabled = false;
    }
    if (region(balance, qsbBalanceMarkup(current.funds, accessHeld))) {
      balance
        ?.querySelector<HTMLButtonElement>("[data-qsb-retry]")
        ?.addEventListener("click", () => load());
      // The prompt is asked in the click itself; either answer re-reads.
      balance
        ?.querySelector<HTMLButtonElement>("[data-qsb-allow]")
        ?.addEventListener("click", () => {
          const attempt = generation;
          void access.request().then(() => {
            if (attempt === generation) load();
          });
        });
    }
    const busy = (v: number): boolean =>
      writes.pendingDeposit(id, v) !== null ||
      writes.pendingStart(id, v) !== null ||
      writes.pendingWithdrawal(id, v) !== null;
    if (
      vaultList &&
      region(vaultList, qsbVaultRows(current.vaults, { busy, writer: account.writer }))
    ) {
      bindRows(vaultList, id);
    }
    const creating = writes.pendingCreate(id);
    if (region(action, qsbVaultActionMarkup(qsbNoVaultLine(account), creating !== null))) {
      find<HTMLButtonElement>("#qsb-vault-new")?.addEventListener("click", () => {
        confirming = true;
        show("confirm");
        find<HTMLButtonElement>("#qsb-vault-create")?.focus();
      });
    }
    if (result) result.textContent = notice;
    for (const vault of current.vaults) {
      const flight = writes.pendingDeposit(id, vault.v);
      if (flight) attachDeposit(vault.v, flight);
      const withdrawal = writes.pendingWithdrawal(id, vault.v);
      if (withdrawal) attachWithdrawal(vault.v, withdrawal);
    }
    if (creating) attachCreate(creating);
    show(creating ? "creating" : confirming ? "confirm" : "detail");
    poll.sync(qsbDepositInFlight(current.vaults) || qsbWithdrawalInFlight(current.vaults));
  };

  const load = (): void => {
    const id = deps.accountId();
    if (id === null) {
      unavailable(friendlyError(QSB_ACCOUNT_REFUSALS.unknownAccount).message, false);
      return;
    }
    if (reading === null) show("loading");
    void read(
      Promise.all([wallet.loadQsbAccounts(), wallet.loadQsbVaults(id), access.check()]),
      ([accounts, next, held]) => {
        accessHeld = held;
        account = accounts.find((entry) => entry.id === id) ?? null;
        if (account === null) {
          reading = null;
          poll.sync(false);
          unavailable(friendlyError(QSB_ACCOUNT_REFUSALS.unknownAccount).message, false);
          return;
        }
        reading = next;
        paint();
      },
      (error) => {
        const line = errorLine(error, "wallet unavailable");
        if (reading === null) return unavailable(line, true);
        notice = line;
        paint();
      },
    );
  };

  const id = deps.accountId();
  const heading = deps.heading;
  if (heading && id !== null) heading.textContent = qsbAccountLabel(id);
  bindCopyButtons(root);
  refresh?.addEventListener("click", () => {
    notice = "";
    load();
  });
  find<HTMLButtonElement>("#qsb-account-retry")?.addEventListener("click", () => load());
  find<HTMLButtonElement>("#qsb-vault-cancel")?.addEventListener("click", () => {
    confirming = false;
    show("detail");
    find<HTMLButtonElement>("#qsb-vault-new")?.focus();
  });
  find<HTMLButtonElement>("#qsb-vault-create")?.addEventListener("click", () => {
    const current = deps.accountId();
    if (current === null || !account?.writer) return;
    notice = "";
    attachCreate(guarded(() => writes.createVault(current)));
    paint();
  });

  load();
  return {
    wipe: () => {
      generation += 1;
      ticket += 1;
      poll.stop();
      attached.clear();
      clearAddress();
    },
  };
};
