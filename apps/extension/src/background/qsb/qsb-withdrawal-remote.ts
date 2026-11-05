/**
 * What the coordinator says about an account's withdrawals, for the listing:
 * its jobs (`GET /v1/jobs`, once) and, for each withdrawal signed here, its
 * transaction's status (`GET /v1/transactions/:txid/status`), which follows
 * the deposit outpoint's spender and reports the txid the chain included.
 * Read-only and best effort: a job list that cannot be read leaves every
 * withdrawal to what is kept here, and a status that cannot be read leaves
 * that one withdrawal to its kept outcome.
 */
import type { QsbJob } from "@bramble/qsb/withdrawal-responses";
import type { QsbWithdrawalRecord } from "@bramble/vault/qsb-withdrawal-store";
import type { QsbCoordinatorSession, QsbVaultDeps } from "./qsb-vault-session";
import type { QsbWithdrawalRemote } from "./qsb-withdrawal-view";

/** Each withdrawal's remote facts, by vault index. */
export type QsbWithdrawalRemotes = (v: number) => QsbWithdrawalRemote;

/** What is known when the coordinator was not, or could not be, asked. */
export const QSB_UNKNOWN_REMOTES: QsbWithdrawalRemotes = () => ({
  job: null,
  jobsKnown: false,
  transaction: null,
});

/** Asks the coordinator about `withdrawals`; nothing when there are none. */
export const readWithdrawalRemotes = async (
  deps: QsbVaultDeps,
  session: QsbCoordinatorSession,
  withdrawals: readonly QsbWithdrawalRecord[],
): Promise<QsbWithdrawalRemotes> => {
  if (withdrawals.length === 0) return QSB_UNKNOWN_REMOTES;
  const jobs: readonly QsbJob[] | null = await session
    .call((token) => deps.coordinator.jobs(token))
    .catch(() => null);
  const statuses = new Map<number, QsbWithdrawalRemote["transaction"]>();
  for (const held of withdrawals) {
    const signed = held.signed;
    if (!signed) continue;
    statuses.set(
      held.v,
      await session
        .call((token) => deps.coordinator.withdrawalStatus(token, signed.txid))
        .catch(() => null),
    );
  }
  return (v) => {
    const held = withdrawals.find((entry) => entry.v === v);
    return {
      job: jobs?.find((job) => job.id === held?.jobId) ?? null,
      jobsKnown: jobs !== null,
      transaction: statuses.get(v) ?? null,
    };
  };
};
