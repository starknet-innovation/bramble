/**
 * Quantum-safe Bitcoin vault fixtures for the UI Lab: the public BIP-173
 * P2WPKH example address, the genesis coinbase txid, one vault per row state,
 * a quote, and a fixture client that answers the journey's account and vault
 * calls from a script. Nothing here is a wallet's own address or a real
 * deposit; nothing reaches a background.
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

/** A vault at index `v` with nothing signed. */
export const unfunded = (v: number): QsbVaultView => ({
  deposit: { amountSat: null, confirmations: null, status: "none", txid: null },
  registered: true,
  state: "allocated",
  v,
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
  readonly accounts?: readonly QsbAccountView[];
  readonly create?: () => Promise<QsbVaultView>;
  readonly deposit?: () => Promise<QsbLabResult>;
  readonly quote?: () => Promise<QsbDepositQuote>;
  readonly reading?: () => Promise<QsbLabReading>;
  readonly resend?: () => Promise<QsbLabResult>;
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
  resendQsbDeposit: script.resend ?? never,
  revealQsbPhrase: never,
});

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
