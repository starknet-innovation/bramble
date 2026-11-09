/**
 * Fixtures for the QSB vault tests: the public BIP-173
 * P2WPKH example address, a public txid, one vault view per row state, a
 * reading, a quote and the deposit results, all in the exact shapes the
 * background sends. Nothing here is a wallet's own address.
 */
import type { QsbDepositQuote, QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import type {
  QsbWithdrawalQuote,
  QsbWithdrawalReview,
  QsbWithdrawalStatus,
} from "@bramble/wallet-model/qsb-withdrawals";
import type {
  QsbDepositResult,
  QsbVaultsReading,
} from "../../src/sidepanel/journeys/qsb/qsb-vault-runtime";
import type { QsbWithdrawalResult } from "../../src/sidepanel/journeys/qsb/qsb-withdrawal-runtime";

/** BIP-173's mainnet P2WPKH example: `bc1q` and 38 bech32 characters. */
export const QSB_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

/** The genesis coinbase txid: 64 lowercase hex characters, public. */
export const QSB_TXID = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

const NO_DEPOSIT: QsbVaultView["deposit"] = {
  amountSat: null,
  confirmations: null,
  status: "none",
  txid: null,
};

/** No withdrawal started. */
const NO_WITHDRAWAL: QsbVaultView["withdrawal"] = {
  confirmations: null,
  destination: null,
  feeSat: null,
  outputSat: null,
  status: "none",
  txid: null,
};

/** A vault at index `v` with nothing signed: Unfunded. */
export const unfundedVault = (v: number): QsbVaultView => ({
  deposit: NO_DEPOSIT,
  registered: true,
  state: "allocated",
  v,
  withdrawal: NO_WITHDRAWAL,
});

/** A vault at index `v` whose deposit is in `status`, for 0.001 BTC. */
export const depositedVault = (
  v: number,
  status: "confirmed" | "pending" | "submitted",
  confirmations: number | null = status === "confirmed" ? 3 : null,
): QsbVaultView => ({
  deposit: { amountSat: 100_000, confirmations, status, txid: QSB_TXID },
  registered: true,
  state: "allocated",
  v,
  withdrawal: NO_WITHDRAWAL,
});

/** One vault per row state, in index order. */
export const EVERY_VAULT: readonly QsbVaultView[] = [
  unfundedVault(0),
  depositedVault(1, "pending"),
  depositedVault(2, "submitted"),
  depositedVault(3, "confirmed"),
  { ...depositedVault(4, "confirmed"), state: "exposed" },
  { ...unfundedVault(5), registered: null, state: "unknown" },
];

/** A reading with 0.0025 BTC confirmed over two outputs. */
export const reading = (
  vaults: readonly QsbVaultView[] = [unfundedVault(0)],
): QsbVaultsReading => ({
  address: QSB_ADDRESS,
  funds: { totalSat: 250_000, utxoCount: 2 },
  vaults,
});

/** The `wallet.qsbVaults` reply for {@link reading}. */
export const vaultsReply = (vaults: readonly QsbVaultView[] = [unfundedVault(0)]) => ({
  ...reading(vaults),
  ok: true,
});

/** A quote for depositing 0.001 BTC at 2.5 sat/vB. */
export const QUOTE: QsbDepositQuote = {
  amountSat: 100_000,
  changeSat: 149_436,
  feeRate: "2.5",
  feeSat: 564,
  inputCount: 2,
  vsize: 225,
  withdrawalFeeSat: 1_200,
};

/** What a deposit or resend into vault `v` answers for each outcome. */
export const depositResult = (
  v: number,
  submission: QsbDepositResult["submission"],
): QsbDepositResult => ({
  submission,
  vault:
    submission === "rejected"
      ? unfundedVault(v)
      : depositedVault(v, submission === "submitted" ? "submitted" : "pending"),
});

/** BIP-173's other mainnet example, P2WSH: a destination that is not the owner address. */
export const DESTINATION = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";

/** A second public txid (block 170's spend), for a withdrawal's own transaction. */
export const WITHDRAWAL_TXID = "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16";

/** The disclosure digest a review names. */
export const DIGEST = "ab".repeat(32);

const RELEASED: readonly QsbWithdrawalStatus[] = ["confirmed", "pending", "submitted", "uncertain"];

/**
 * A funded deposit at index `v` whose withdrawal is in `status`: to
 * {@link DESTINATION} at 900 sat, receiving the deposit plus a 10,000 sat
 * helper; a released one has its own txid, a mined one 2 confirmations.
 */
export const withdrawingVault = (
  v: number,
  status: QsbWithdrawalStatus,
  confirmations: number | null = status === "confirmed" ? 2 : null,
): QsbVaultView => ({
  ...depositedVault(v, "confirmed"),
  state: RELEASED.includes(status) || status === "conflict" ? "exposed" : "allocated",
  withdrawal:
    status === "none"
      ? depositedVault(v, "confirmed").withdrawal
      : {
          confirmations,
          destination: DESTINATION,
          feeSat: 900,
          outputSat: 109_100,
          status,
          txid: RELEASED.includes(status) ? WITHDRAWAL_TXID : null,
        },
});

/**
 * A deposit a read-only QSB vault recovered: its history `unknown`, its
 * withdrawal in `status` as {@link withdrawingVault} has it.
 */
export const recoveredVault = (v: number, status: QsbWithdrawalStatus): QsbVaultView => ({
  ...withdrawingVault(v, status),
  state: "unknown",
});

/** A quote withdrawing the 0.001 BTC deposit plus 10,000 sat to {@link DESTINATION}. */
export const WITHDRAWAL_QUOTE: QsbWithdrawalQuote = {
  destination: DESTINATION,
  feeRate: "4",
  feeSat: 900,
  fundingSat: 100_000,
  helperSat: 10_000,
  outputSat: 109_100,
  vsize: 225,
};

/**
 * The release review of deposit `v`'s withdrawal at {@link WITHDRAWAL_QUOTE}'s
 * terms: the writer's (`conformant`) unless `custody` says otherwise.
 */
export const withdrawalReview = (
  v: number,
  custody: QsbWithdrawalReview["custody"] = "conformant",
): QsbWithdrawalReview => ({
  binding: "unverified",
  custody,
  destination: DESTINATION,
  digest: DIGEST,
  feeSat: 900,
  fundingSat: 100_000,
  helperSat: 10_000,
  network: "bitcoin-mainnet",
  outputSat: 109_100,
  secrets: 15,
  v,
  vsize: 1_180,
});

/** What a release or withdrawal resend of deposit `v` answers for each outcome. */
export const withdrawalResult = (
  v: number,
  submission: QsbWithdrawalResult["submission"],
): QsbWithdrawalResult => ({
  submission,
  vault: withdrawingVault(v, submission === "uncertain" ? "uncertain" : submission),
});
