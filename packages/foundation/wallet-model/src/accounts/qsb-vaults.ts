/**
 * The contract the background and the wallet UI share for Quantum Safe Bitcoin
 * (QSB) vaults and their deposits: the public view of a vault, a deposit
 * quote, the bounds both sides enforce, and the refusal diagnostics the
 * background throws and the UI translates. Shapes and constants only; whoever
 * receives a reply validates it again before trusting it.
 *
 * Each QSB account has one Bitcoin owner address, the BIP-84 P2WPKH address
 * `m/84'/0'/0'/0/0` of its own phrase. It signs in to the QSB coordinator,
 * pays every deposit and takes its change. A vault is a bare script built from
 * the commitments of one vault index `v`, registered with the coordinator and
 * funded exactly once through MARA Slipstream.
 *
 * The messages, all for extension pages only and never reachable by a site:
 * - `wallet.qsbVaults` `{ accountId }`: the owner address, its confirmed funds
 *   (null when the coordinator cannot be reached) and every vault. Records a
 *   deposit the chain now confirms; otherwise reads only.
 * - `wallet.createQsbVault` `{ accountId }`: allocates the next vault, builds
 *   its script and registers it. Only a writer account may.
 * - `wallet.quoteQsbDeposit` `{ accountId, v, amountSat }`: what a deposit of
 *   `amountSat` into vault `v` would cost now. Reads only.
 * - `wallet.depositQsbVault` `{ accountId, v, amountSat, feeSat }`: builds,
 *   signs and submits that deposit. `feeSat` is the fee the user accepted; a
 *   deposit that would now cost anything else is refused as `quoteChanged`.
 * - `wallet.resendQsbDeposit` `{ accountId, v }`: sends a pending deposit's
 *   same signed bytes again, never new ones.
 */

/** Smallest deposit, in satoshis: below it a withdrawal's fee eats the vault. */
export const QSB_MIN_DEPOSIT_SAT = 10_000;

/** Largest satoshi amount anything here may name: 21 million BTC. */
export const QSB_MAX_SAT = 2_100_000_000_000_000;

/**
 * Where a vault's one deposit stands. `none`: nothing signed. `pending`:
 * signed and kept here, not yet known to MARA. `submitted`: MARA has it.
 * `confirmed`: mined, and recorded as the vault's funding.
 */
export type QsbDepositStatus = "confirmed" | "none" | "pending" | "submitted";

/**
 * One vault as the UI may see it. `state` is the disclosure journal's
 * (`allocated` until a withdrawal discloses). `registered` is whether the
 * coordinator holds the vault's script, null when it could not be asked.
 * `deposit` carries public chain data only.
 */
export type QsbVaultView = {
  readonly deposit: {
    readonly amountSat: number | null;
    readonly confirmations: number | null;
    readonly status: QsbDepositStatus;
    readonly txid: string | null;
  };
  readonly registered: boolean | null;
  readonly state: "allocated" | "exposed" | "retired" | "unknown";
  readonly v: number;
};

/** The owner address's confirmed funds, as the coordinator's chain API reports them. */
export type QsbOwnerFunds = {
  readonly totalSat: number;
  readonly utxoCount: number;
};

/**
 * What one deposit would cost now. `feeRate` is sat/vB as decimal text (the
 * MARA floor); `changeSat` is 0 when there is no change output;
 * `withdrawalFeeSat` estimates the later withdrawal at the same rate.
 */
export type QsbDepositQuote = {
  readonly amountSat: number;
  readonly changeSat: number;
  readonly feeRate: string;
  readonly feeSat: number;
  readonly inputCount: number;
  readonly vsize: number;
  readonly withdrawalFeeSat: number;
};

/**
 * How the coordinator answered a submitted deposit: `submitted` (MARA has
 * it), `uncertain` (unknown; the same bytes may be resent) or `rejected`
 * (MARA refused it and the vault takes a new deposit).
 */
export type QsbSubmission = "rejected" | "submitted" | "uncertain";

/**
 * The diagnostics the background throws when it refuses a QSB vault request.
 * The UI's copy table matches each one exactly, so changing one here changes
 * both sides.
 */
export const QSB_VAULT_REFUSALS = {
  amountTooSmall: "qsb deposit amount is too small",
  coordinatorDisabled: "qsb deposits are switched off",
  coordinatorUnavailable: "qsb coordinator unavailable",
  depositPending: "qsb deposit is already pending",
  insufficientFunds: "qsb deposit needs more bitcoin",
  minerRateUnavailable: "qsb miner rate unavailable",
  notDepositable: "qsb vault cannot take a deposit",
  notWriter: "qsb account cannot create vaults",
  quoteChanged: "qsb deposit quote changed",
  runtimeUnavailable: "qsb runtime unavailable",
  scriptTaken: "qsb vault script is already used",
  signInRefused: "qsb sign-in refused",
  unknownVault: "unknown qsb vault",
  vaultLimit: "qsb vault limit reached",
} as const;
