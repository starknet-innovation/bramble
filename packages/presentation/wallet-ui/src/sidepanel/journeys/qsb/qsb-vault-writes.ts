/**
 * The QSB vault writes the journey allows in flight: one deposit creation per
 * QSB vault, one funding or resend per deposit, one withdrawal start per
 * deposit, and one release or withdrawal resend per deposit. A second request
 * while one runs gets the same promise back, so a double tap, a repaint or
 * leaving and coming back can never send a second write; the screen only
 * reattaches to the first one's progress. Created once by the journey and
 * outlives every screen; it holds ids and promises only. A release's
 * authorization stays in the caller's own `send`, which runs at once and is
 * never kept here.
 */
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import type { QsbDepositResult, QsbVaultWallet } from "./qsb-vault-runtime";
import type { QsbWithdrawalResult, QsbWithdrawalWallet } from "./qsb-withdrawal-runtime";

/** The guarded writes, and what is in flight now. */
export type QsbVaultWrites = {
  /** Creates the account's next vault, or returns the creation already running. */
  readonly createVault: (accountId: string) => Promise<QsbVaultView>;
  /** Deposits into vault `v`, or returns the deposit or resend already running on it. */
  readonly deposit: (
    accountId: string,
    v: number,
    amountSat: number,
    feeSat: number,
  ) => Promise<QsbDepositResult>;
  /** The account's vault creation in flight, or null. */
  readonly pendingCreate: (accountId: string) => Promise<QsbVaultView> | null;
  /** Vault `v`'s deposit or resend in flight, or null. */
  readonly pendingDeposit: (accountId: string, v: number) => Promise<QsbDepositResult> | null;
  /** Vault `v`'s withdrawal start in flight, or null. */
  readonly pendingStart: (accountId: string, v: number) => Promise<QsbVaultView> | null;
  /** Vault `v`'s release or withdrawal resend in flight, or null. */
  readonly pendingWithdrawal: (accountId: string, v: number) => Promise<QsbWithdrawalResult> | null;
  /**
   * Releases vault `v`'s withdrawal through `send`, which carries the
   * user's authorization; or returns the release or resend already running.
   */
  readonly release: (
    accountId: string,
    v: number,
    send: () => Promise<QsbWithdrawalResult>,
  ) => Promise<QsbWithdrawalResult>;
  /** Resends vault `v`'s pending deposit, or returns the write already running on it. */
  readonly resend: (accountId: string, v: number) => Promise<QsbDepositResult>;
  /** Resends vault `v`'s signed withdrawal, or returns the release or resend already running. */
  readonly resendWithdrawal: (accountId: string, v: number) => Promise<QsbWithdrawalResult>;
  /** Starts vault `v`'s withdrawal at `feeSat`, or returns the start already running. */
  readonly startWithdrawal: (
    accountId: string,
    v: number,
    destination: string,
    feeSat: number,
  ) => Promise<QsbVaultView>;
};

const vaultKey = (accountId: string, v: number): string => `${accountId}:${v}`;

/**
 * Creates the guard over `wallet`. Each entry is dropped as its write
 * settles, whichever way, so the next request after that is a new write.
 */
export const createQsbVaultWrites = (
  wallet: Pick<QsbVaultWallet, "createQsbVault" | "depositQsbVault" | "resendQsbDeposit"> &
    Pick<QsbWithdrawalWallet, "resendQsbWithdrawal" | "startQsbWithdrawal">,
): QsbVaultWrites => {
  const creations = new Map<string, Promise<QsbVaultView>>();
  const deposits = new Map<string, Promise<QsbDepositResult>>();
  const starts = new Map<string, Promise<QsbVaultView>>();
  const withdrawals = new Map<string, Promise<QsbWithdrawalResult>>();

  const once = <T>(flights: Map<string, Promise<T>>, key: string, run: () => Promise<T>) => {
    const running = flights.get(key);
    if (running) return running;
    const flight = run();
    flights.set(key, flight);
    const drop = (): void => {
      if (flights.get(key) === flight) flights.delete(key);
    };
    flight.then(drop, drop);
    return flight;
  };

  return {
    createVault: (accountId) => once(creations, accountId, () => wallet.createQsbVault(accountId)),
    deposit: (accountId, v, amountSat, feeSat) =>
      once(deposits, vaultKey(accountId, v), () =>
        wallet.depositQsbVault(accountId, v, amountSat, feeSat),
      ),
    pendingCreate: (accountId) => creations.get(accountId) ?? null,
    pendingDeposit: (accountId, v) => deposits.get(vaultKey(accountId, v)) ?? null,
    pendingStart: (accountId, v) => starts.get(vaultKey(accountId, v)) ?? null,
    pendingWithdrawal: (accountId, v) => withdrawals.get(vaultKey(accountId, v)) ?? null,
    release: (accountId, v, send) => once(withdrawals, vaultKey(accountId, v), send),
    resend: (accountId, v) =>
      once(deposits, vaultKey(accountId, v), () => wallet.resendQsbDeposit(accountId, v)),
    resendWithdrawal: (accountId, v) =>
      once(withdrawals, vaultKey(accountId, v), () => wallet.resendQsbWithdrawal(accountId, v)),
    startWithdrawal: (accountId, v, destination, feeSat) =>
      once(starts, vaultKey(accountId, v), () =>
        wallet.startQsbWithdrawal(accountId, v, destination, feeSat),
      ),
  };
};
