/**
 * QSB vault and deposit fixtures for the UI Lab: the public BIP-173
 * P2WPKH example address, the genesis coinbase txid, one vault per row state,
 * a quote, a fixture client that answers the journey's account, vault and
 * withdrawal calls from a script, and the browser's coordinator grant. Nothing here is a
 * wallet's own address or a real deposit; nothing reaches a background or
 * prompts the browser.
 */
import type { QsbAccountView } from "@bramble/wallet-model/qsb";
import type { QsbDepositQuote, QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import type { createQsbJourney } from "@bramble/wallet-ui/lab";
import type { FrameContext } from "../runtime/types";

/** The journey's client, as the lab drives it. */
export type QsbLabWallet = Parameters<typeof createQsbJourney>[0]["wallet"];
/** What the vault read answers. */
export type QsbLabReading = Awaited<ReturnType<QsbLabWallet["loadQsbVaults"]>>;
/** What a deposit or resend answers. */
export type QsbLabResult = Awaited<ReturnType<QsbLabWallet["depositQsbVault"]>>;
/** What a withdrawal quote answers. */
export type QsbLabWithdrawalQuote = Awaited<ReturnType<QsbLabWallet["quoteQsbWithdrawal"]>>;
/** What a release review answers. */
export type QsbLabReview = Awaited<ReturnType<QsbLabWallet["reviewQsbWithdrawal"]>>;
/** What a release or withdrawal resend answers. */
export type QsbLabWithdrawalResult = Awaited<ReturnType<QsbLabWallet["releaseQsbWithdrawal"]>>;
/** The browser permission API the journey checks and asks. */
type QsbLabPermissions = NonNullable<Parameters<typeof createQsbJourney>[0]["permissions"]>;

const ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const TXID = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

/** A writer account and the three that cannot make vaults. */
export const QSB_LAB_ACCOUNTS = {
  backupNeeded: {
    backupConfirmed: false,
    id: "qsb-1",
    journal: "bound",
    provenance: "generated-here",
    writer: false,
  },
  readOnly: {
    backupConfirmed: true,
    id: "qsb-3",
    journal: "bound",
    provenance: "imported",
    writer: false,
  },
  ready: {
    backupConfirmed: true,
    id: "qsb-2",
    journal: "bound",
    provenance: "generated-here",
    writer: true,
  },
} as const satisfies Record<string, QsbAccountView>;

const NO_WITHDRAWAL: QsbVaultView["withdrawal"] = {
  confirmations: null,
  destination: null,
  feeSat: null,
  outputSat: null,
  status: "none",
  txid: null,
};

/** A vault at index `v` with nothing signed. */
export const unfunded = (v: number): QsbVaultView => ({
  deposit: { amountSat: null, confirmations: null, status: "none", txid: null },
  registered: true,
  state: "allocated",
  v,
  withdrawal: NO_WITHDRAWAL,
});

/** A vault at index `v` whose 0.001 BTC deposit is in `status`. */
export const deposited = (
  v: number,
  status: "confirmed" | "pending" | "submitted",
): QsbVaultView => ({
  deposit: {
    amountSat: 100_000,
    confirmations: status === "confirmed" ? 3 : null,
    status,
    txid: TXID,
  },
  registered: true,
  state: "allocated",
  v,
  withdrawal: NO_WITHDRAWAL,
});

/** One vault per row state. */
export const EVERY_VAULT: readonly QsbVaultView[] = [
  unfunded(0),
  deposited(1, "pending"),
  deposited(2, "submitted"),
  deposited(3, "confirmed"),
  { ...deposited(4, "confirmed"), state: "exposed" },
  { ...unfunded(5), registered: null, state: "unknown" },
];

/** 0.0025 BTC confirmed over two outputs, and `vaults`. */
export const labReading = (vaults: readonly QsbVaultView[]): QsbLabReading => ({
  address: ADDRESS,
  funds: { totalSat: 250_000, utxoCount: 2 },
  vaults,
});

/** A deposit of 0.001 BTC at 2.5 sat/vB. */
export const QUOTE: QsbDepositQuote = {
  amountSat: 100_000,
  changeSat: 149_436,
  feeRate: "2.5",
  feeSat: 564,
  inputCount: 2,
  vsize: 225,
  withdrawalFeeSat: 1_200,
};

/** Each submission outcome for vault `v`, in the shape the background sends. */
export const outcome = (v: number, submission: QsbLabResult["submission"]): QsbLabResult => ({
  submission,
  vault:
    submission === "rejected"
      ? unfunded(v)
      : deposited(v, submission === "submitted" ? "submitted" : "pending"),
});

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** How each fixture call answers; an unset write never settles, like a busy worker. */
export type QsbLabScript = {
  /** The coordinator grant: held or not, and how the prompt answers. Held when unset. */
  readonly access?: { readonly answer: boolean; readonly granted: boolean };
  readonly accounts?: readonly QsbAccountView[];
  readonly create?: () => Promise<QsbVaultView>;
  readonly deposit?: () => Promise<QsbLabResult>;
  readonly quote?: () => Promise<QsbDepositQuote>;
  readonly reading?: () => Promise<QsbLabReading>;
  readonly recover?: () => Promise<QsbLabReading>;
  readonly release?: () => Promise<QsbLabWithdrawalResult>;
  readonly resend?: () => Promise<QsbLabResult>;
  readonly review?: () => Promise<QsbLabReview>;
  readonly startWithdrawal?: () => Promise<QsbVaultView>;
  readonly withdrawalQuote?: () => Promise<QsbLabWithdrawalQuote>;
  readonly withdrawalResend?: () => Promise<QsbLabWithdrawalResult>;
};

/** A fixture client over `script`; the account phrase calls are never asked here. */
export const qsbLabWallet = (script: QsbLabScript): QsbLabWallet => ({
  confirmQsbBackup: never,
  createQsbAccount: never,
  createQsbVault: script.create ?? never,
  depositQsbVault: script.deposit ?? never,
  importQsbAccount: never,
  loadQsbAccounts: async () => script.accounts ?? [QSB_LAB_ACCOUNTS.ready],
  loadQsbVaults: script.reading ?? (async () => labReading(EVERY_VAULT)),
  quoteQsbDeposit: script.quote ?? (async () => QUOTE),
  quoteQsbWithdrawal: script.withdrawalQuote ?? never,
  recoverQsbVaults: script.recover ?? never,
  releaseQsbWithdrawal: script.release ?? never,
  resendQsbDeposit: script.resend ?? never,
  resendQsbWithdrawal: script.withdrawalResend ?? never,
  revealQsbPhrase: never,
  reviewQsbWithdrawal: script.review ?? never,
  startQsbWithdrawal: script.startWithdrawal ?? never,
});

/** What the background reads without the grant: no funds, registration unknown. */
export const ungrantedReading = (vaults: readonly QsbVaultView[]): QsbLabReading => ({
  ...labReading(vaults.map((vault) => ({ ...vault, registered: null }))),
  funds: null,
});

/**
 * The coordinator grant as `script` plays it. Asking is logged and answered
 * from the script; the browser is never prompted.
 */
export const labPermissions = (context: FrameContext, script: QsbLabScript): QsbLabPermissions => {
  const access = script.access ?? { answer: true, granted: true };
  let held = access.granted;
  return {
    contains: async () => held,
    request: async () => {
      context.emit({
        detail: `coordinator access asked: ${access.answer ? "allowed" : "denied"}`,
        kind: "action",
      });
      held = held || access.answer;
      return access.answer;
    },
  };
};

/**
 * Timers whose task never runs, so a checkpoint stays still: arming the
 * account screen's poll is logged instead, behind an empty platform timer.
 */
export const labTimers = (context: FrameContext) => ({
  clear: (handle: ReturnType<typeof setTimeout>): void => clearTimeout(handle),
  set: (_task: () => void, ms: number): ReturnType<typeof setTimeout> => {
    context.emit({ detail: `poll armed (${ms / 1000} s)`, kind: "state" });
    return setTimeout(() => undefined, 0);
  },
});
