/**
 * One Quantum-safe Bitcoin account, opened from the accounts list: its owner
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
 */
import { QSB_ACCOUNT_REFUSALS, type QsbAccountView } from "@bramble/wallet-model/qsb";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import { friendlyError } from "../../runtime/friendly-error";
import { bindCopyButtons, buttonBusy, errorLine, renderFragment } from "../../shared/dom";
import type { StageTimers } from "../../shared/stage-pacer";
import {
  type QsbAccountStep,
  qsbBalanceMarkup,
  qsbVaultActionMarkup,
  qsbVaultRows,
} from "./qsb-account-view";
import { qsbAccountLabel } from "./qsb-model";
import type { QsbWallet } from "./qsb-runtime";
import {
  qsbDepositInFlight,
  qsbNoVaultLine,
  qsbSubmissionLine,
  qsbVaultWriteFailure,
} from "./qsb-vault-model";
import { createQsbVaultPoll } from "./qsb-vault-poll";
import {
  isQsbVaultIndex,
  type QsbDepositResult,
  type QsbVaultsReading,
  type QsbVaultWallet,
} from "./qsb-vault-runtime";
import type { QsbVaultWrites } from "./qsb-vault-writes";

/** What the account binding needs. `accountId` is read live, never copied. */
export type QsbAccountDeps = {
  readonly accountId: () => string | null;
  readonly openDeposit: (accountId: string, v: number) => void;
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
  const { root, wallet, writes } = deps;
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
        wallet.loadQsbVaults(id),
        (next) => {
          reading = next;
          paint();
        },
        () => undefined,
        false,
      );
    },
    timers: deps.timers,
  });

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
          notice = qsbVaultWriteFailure(error, "wallet request failed");
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
        notice = qsbVaultWriteFailure(error, "wallet request failed");
        paint();
      },
    );
  };

  const bindRows = (list: Element, id: string): void => {
    for (const control of list.querySelectorAll<HTMLButtonElement>("[data-qsb-deposit]")) {
      const v = Number(control.dataset["qsbDeposit"]);
      if (isQsbVaultIndex(v)) control.addEventListener("click", () => deps.openDeposit(id, v));
    }
    for (const control of list.querySelectorAll<HTMLButtonElement>("[data-qsb-resend]")) {
      const v = Number(control.dataset["qsbResend"]);
      if (!isQsbVaultIndex(v)) continue;
      control.addEventListener("click", () => {
        notice = "";
        attachDeposit(v, writes.resend(id, v));
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
    if (region(balance, qsbBalanceMarkup(current.funds))) {
      balance
        ?.querySelector<HTMLButtonElement>("[data-qsb-retry]")
        ?.addEventListener("click", () => load());
    }
    const busy = (v: number): boolean => writes.pendingDeposit(id, v) !== null;
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
    }
    if (creating) attachCreate(creating);
    show(creating ? "creating" : confirming ? "confirm" : "detail");
    poll.sync(qsbDepositInFlight(current.vaults));
  };

  const load = (): void => {
    const id = deps.accountId();
    if (id === null) {
      unavailable(friendlyError(QSB_ACCOUNT_REFUSALS.unknownAccount).message, false);
      return;
    }
    if (reading === null) show("loading");
    void read(
      Promise.all([wallet.loadQsbAccounts(), wallet.loadQsbVaults(id)]),
      ([accounts, next]) => {
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

  const label = find<HTMLElement>("#qsb-account-label");
  const id = deps.accountId();
  if (label) label.textContent = id === null ? "" : qsbAccountLabel(id);
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
    attachCreate(writes.createVault(current));
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
