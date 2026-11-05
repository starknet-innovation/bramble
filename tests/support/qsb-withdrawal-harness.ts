/**
 * A QSB vault harness (./qsb-vault-harness) with deposit 0 funded and
 * confirmed and one helper output at the owner address: the starting point
 * of every withdrawal suite. Real Krusty, real vault service, the stand-in
 * coordinator and runtime.
 */

import type { KmsPort } from "@bramble/vault/kms-port";
import type { QsbDepositQuote } from "@bramble/wallet-model/qsb-vaults";
import type {
  QsbWithdrawalQuote,
  QsbWithdrawalReview,
} from "@bramble/wallet-model/qsb-withdrawals";
import { paymentToAddress } from "./qsb-coordinator-fake";
import { QSB_HARNESS_PASSPHRASE, type QsbVaultHarness, qsbVaultHarness } from "./qsb-vault-harness";
import { FAKE_SOLUTION, solveFakeJob } from "./qsb-withdrawal-fake";

/** The deposit every withdrawal suite withdraws, in satoshis. */
export const WITHDRAWN_DEPOSIT_SAT = 100_000;

/** The helper output's value, in satoshis. */
export const HELPER_SAT = 2_000;

/** A payable P2WPKH destination (BIP-84's published vector). */
export const DESTINATION = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";

/** A harness whose deposit 0 is confirmed, and helpers to drive a withdrawal. */
export type QsbWithdrawalHarness = QsbVaultHarness & {
  readonly depositTxid: string;
  /** The withdrawal's one job id, once started. */
  readonly jobId: () => string;
  readonly quote: (destination?: string) => Promise<QsbWithdrawalQuote>;
  readonly release: (digest: string, passphrase?: string) => Promise<Record<string, unknown>>;
  readonly review: () => Promise<QsbWithdrawalReview>;
  readonly solve: (solution?: Record<string, unknown>) => void;
  readonly start: (feeSat: number, destination?: string) => Promise<Record<string, unknown>>;
};

/** Builds the harness; `kms` may wrap the real Krusty adapter. */
export const qsbWithdrawalHarness = async (
  options: { readonly kms?: (kms: KmsPort) => KmsPort } = {},
): Promise<QsbWithdrawalHarness> => {
  const harness = await qsbVaultHarness({ funds: [300_000], ...options });
  await harness.send({ accountId: "qsb-1", type: "wallet.createQsbVault" });
  const quoteDeposit = { accountId: "qsb-1", amountSat: WITHDRAWN_DEPOSIT_SAT, v: 0 } as const;
  const { quote } = (await harness.send({ ...quoteDeposit, type: "wallet.quoteQsbDeposit" })) as {
    readonly quote: QsbDepositQuote;
  };
  const deposited = (await harness.send({
    ...quoteDeposit,
    feeSat: quote.feeSat,
    type: "wallet.depositQsbVault",
  })) as { readonly vault: { readonly deposit: { readonly txid: string } } };
  const depositTxid = deposited.vault.deposit.txid;
  harness.state.confirmed.add(depositTxid);
  // The listing records the confirmed funding in the journal.
  await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" });
  harness.state.utxos = paymentToAddress(harness.owner, [HELPER_SAT], "withdrawal helper");
  harness.state.calls.length = 0;
  harness.events.length = 0;
  const jobId = () => {
    const [id] = harness.state.jobs.keys();
    if (!id) throw new Error("no withdrawal job");
    return id;
  };
  return {
    ...harness,
    depositTxid,
    jobId,
    quote: async (destination = DESTINATION) =>
      (
        (await harness.send({
          accountId: "qsb-1",
          destination,
          type: "wallet.quoteQsbWithdrawal",
          v: 0,
        })) as { readonly quote: QsbWithdrawalQuote }
      ).quote,
    release: async (digest, passphrase = QSB_HARNESS_PASSPHRASE) =>
      (await harness.send({
        accountId: "qsb-1",
        digest,
        passphrase,
        type: "wallet.releaseQsbWithdrawal",
        v: 0,
      })) as Record<string, unknown>,
    review: async () =>
      (
        (await harness.send({ accountId: "qsb-1", type: "wallet.reviewQsbWithdrawal", v: 0 })) as {
          readonly review: QsbWithdrawalReview;
        }
      ).review,
    solve: (solution = FAKE_SOLUTION) => solveFakeJob(harness.state, jobId(), { ...solution }),
    start: async (feeSat, destination = DESTINATION) =>
      (await harness.send({
        accountId: "qsb-1",
        destination,
        feeSat,
        type: "wallet.startQsbWithdrawal",
        v: 0,
      })) as Record<string, unknown>,
  };
};
