/**
 * A QSB withdrawal's terms: what withdrawing one deposit to one destination
 * pays and costs now, shared by `wallet.quoteQsbWithdrawal` (which stops
 * here) and `wallet.startQsbWithdrawal` (qsb-app `sdk/client.ts`
 * `createWithdrawal`, the spec's §1).
 *
 * In order, each refusing before anything is written or sent: the
 * destination is a payable mainnet address (Bramble derives its script and
 * dust floor itself); the vault is this account's, `allocated`, funded in the
 * journal and has its script; the deployment takes withdrawals end to end;
 * the coordinator lists the vault and `…/funding` confirms the very funding
 * the journal recorded; the helper is the smallest confirmed owner output
 * (ties by txid, then vout) that is not the funding, not an input of a
 * deposit kept here, and not another withdrawal's helper; the fee rate is
 * `QSB_WITHDRAWAL_FEE_MULTIPLIER` × MARA's floor, to the millisatoshi; the fee
 * is that rate on the withdrawal's upper-bound size; and the payout clears
 * the destination's dust floor.
 */
import { bytesToHex } from "@bramble/core/hex";
import { qsbFeeAt, qsbFormatFeeRate, qsbWithdrawalVsize } from "@bramble/qsb/fees";
import type { QsbOutpoint } from "@bramble/qsb/responses";
import { parseQsbTransaction } from "@bramble/qsb/transactions";
import type { QsbFundingStatus, QsbPublicVault } from "@bramble/qsb/vault-responses";
import { type QsbDestination, qsbDestination } from "@bramble/qsb/withdrawal-destination";
import type { QsbFunding, QsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import type { QsbWithdrawalRecord } from "@bramble/vault/qsb-withdrawal-store";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import {
  QSB_WITHDRAWAL_FEE_MULTIPLIER,
  type QsbWithdrawalQuote,
} from "@bramble/wallet-model/qsb-withdrawals";
import { requireWithdrawalsOpen } from "./qsb-vault-gates";
import { minerFloorMsat, type QsbDepositContext } from "./qsb-vault-prepare";
import { journalUnavailable, qsbRefusal, withdrawalRefusal } from "./qsb-vault-refusals";

/** A journal record that can be withdrawn: allocated, scripted and funded. */
export type QsbWithdrawableRecord = QsbVaultRecord & {
  readonly funding: QsbFunding;
  readonly scriptHash: string;
  readonly scriptPubKey: string;
};

/** Everything a withdrawal's start needs beside its quote. */
export type QsbWithdrawalTerms = {
  readonly destination: QsbDestination;
  readonly helper: QsbOutpoint;
  readonly quote: QsbWithdrawalQuote;
  readonly record: QsbWithdrawableRecord;
  readonly server: QsbPublicVault;
  readonly solverReleaseId: string;
};

/** The destination `address` names, refused unless Bramble may pay it. */
export const payableDestination = (address: string): QsbDestination => {
  const destination = qsbDestination(address);
  if (!destination) throw withdrawalRefusal("destinationInvalid");
  return destination;
};

/** The journal record of vault `v`, refused unless it can be withdrawn. */
export const withdrawableRecord = async (
  access: Pick<QsbVaultAccess, "journal">,
  v: number,
  states: readonly QsbVaultRecord["state"][] = ["allocated"],
): Promise<QsbWithdrawableRecord> => {
  const journal = await access.journal();
  if (journal.status !== "bound") throw journalUnavailable();
  const record = journal.vaults.find((vault) => vault.v === v);
  if (!record) throw qsbRefusal("unknownVault");
  if (
    !states.includes(record.state) ||
    record.funding === null ||
    record.scriptHash === null ||
    record.scriptPubKey === null
  ) {
    throw withdrawalRefusal("notWithdrawable");
  }
  return record as QsbWithdrawableRecord;
};

/** The account's withdrawals, refused when the record cannot be read. */
export const keptWithdrawals = async (
  access: Pick<QsbVaultAccess, "withdrawals">,
): Promise<readonly QsbWithdrawalRecord[]> => {
  const withdrawals = await access.withdrawals();
  if (withdrawals === null) throw journalUnavailable();
  return withdrawals;
};

const sameFunding = (record: QsbWithdrawableRecord, status: QsbFundingStatus): boolean => {
  const funding = status.vault.funding;
  return (
    status.confirmed &&
    funding !== null &&
    funding.txid === record.funding.txid &&
    funding.vout === record.funding.vout &&
    funding.valueSat === record.funding.valueSat
  );
};

/**
 * The coordinator's record of this vault and its confirmed funding (its
 * previous transaction included), refused unless the coordinator lists this
 * very script and confirms the journal's funding.
 */
const confirmedServerVault = async (
  context: QsbDepositContext,
  record: QsbWithdrawableRecord,
): Promise<{ readonly funding: QsbFundingStatus; readonly server: QsbPublicVault }> => {
  const { deps, session } = context;
  const listed = await session.call((token) => deps.coordinator.vaults(token));
  const server = listed.vaults.find((vault) => vault.scriptHash === record.scriptHash);
  if (!server || server.scriptHex !== record.scriptPubKey) {
    throw withdrawalRefusal("notWithdrawable");
  }
  const funding = await session.call((token) => deps.coordinator.funding(token, server.id));
  if (!sameFunding(record, funding) || funding.vault.id !== server.id) {
    throw withdrawalRefusal("notWithdrawable");
  }
  return { funding, server };
};

const outpointKey = (txid: string, vout: number): string => `${txid}:${vout}`;

// Every owner output a helper may not be: the deposit itself, an input of a
// deposit kept here, and another withdrawal's helper.
const frozenOutpoints = async (
  access: QsbVaultAccess,
  record: QsbWithdrawableRecord,
): Promise<ReadonlySet<string>> => {
  const pending = await access.pendingDeposits();
  if (pending === null) throw journalUnavailable();
  const frozen = new Set([outpointKey(record.funding.txid, record.funding.vout)]);
  for (const { helper } of await keptWithdrawals(access)) {
    frozen.add(outpointKey(helper.txid, helper.vout));
  }
  for (const deposit of pending) {
    const tx = parseQsbTransaction(deposit.rawTxHex);
    if (tx === null) throw journalUnavailable();
    for (let index = 0; index < tx.inputsLength; index += 1) {
      const input = tx.getInput(index);
      if (input.txid === undefined || input.index === undefined) throw journalUnavailable();
      frozen.add(outpointKey(bytesToHex(input.txid), input.index));
    }
  }
  return frozen;
};

/** The helper: the smallest output not frozen, ties by txid then vout. */
const chooseHelper = (
  coins: readonly QsbOutpoint[],
  frozen: ReadonlySet<string>,
): QsbOutpoint | null =>
  [...coins]
    .filter((coin) => !frozen.has(outpointKey(coin.txid, coin.vout)))
    .sort(
      (left, right) =>
        left.valueSat - right.valueSat ||
        (left.txid < right.txid ? -1 : left.txid > right.txid ? 1 : 0) ||
        left.vout - right.vout,
    )[0] ?? null;

/**
 * The quote for paying `fundingSat` plus `helperSat` to `destination` at
 * `rateMsat`, refused when the payout would not clear its dust floor.
 */
const withdrawalQuote = (input: {
  readonly destination: QsbDestination;
  readonly fundingSat: number;
  readonly helperSat: number;
  readonly rateMsat: bigint;
}): QsbWithdrawalQuote => {
  const vsize = qsbWithdrawalVsize(input.destination.outputScript.length / 2);
  const feeSat = qsbFeeAt(vsize, input.rateMsat);
  const outputSat = BigInt(input.fundingSat) + BigInt(input.helperSat) - feeSat;
  if (outputSat < BigInt(input.destination.dustSat)) throw withdrawalRefusal("dustOutput");
  return {
    destination: input.destination.address,
    feeRate: qsbFormatFeeRate(input.rateMsat),
    feeSat: Number(feeSat),
    fundingSat: input.fundingSat,
    helperSat: input.helperSat,
    outputSat: Number(outputSat),
    vsize,
  };
};

/**
 * The terms of withdrawing vault `v` to `address` now. Writes and sends
 * nothing but reads; refuses with the contract's diagnostics.
 */
export const withdrawalTerms = async (
  context: QsbDepositContext,
  request: { readonly destination: string; readonly v: number },
): Promise<QsbWithdrawalTerms> => {
  const { access, deps, session } = context;
  const destination = payableDestination(request.destination);
  const record = await withdrawableRecord(access, request.v);
  if ((await keptWithdrawals(access)).some((held) => held.v === request.v)) {
    throw withdrawalRefusal("notWithdrawable");
  }
  const solverReleaseId = requireWithdrawalsOpen(await deps.coordinator.config());
  const { server } = await confirmedServerVault(context, record);
  const frozen = await frozenOutpoints(access, record);
  const coins = await session.call((token) => deps.coordinator.paymentUtxos(token));
  const helper = chooseHelper(coins, frozen);
  if (!helper) throw withdrawalRefusal("helperNeeded");
  const rateMsat = (await minerFloorMsat(deps)) * BigInt(QSB_WITHDRAWAL_FEE_MULTIPLIER);
  const quote = withdrawalQuote({
    destination,
    fundingSat: record.funding.valueSat,
    helperSat: helper.valueSat,
    rateMsat,
  });
  return { destination, helper, quote, record, server, solverReleaseId };
};

/**
 * The quote a withdrawal already intended here stands at: its own terms,
 * for the very destination it pays. Its rate is the fee over the size bound.
 */
export const intendedQuote = (held: QsbWithdrawalRecord): QsbWithdrawalQuote => {
  const destination = payableDestination(held.destination);
  const vsize = qsbWithdrawalVsize(destination.outputScript.length / 2);
  return {
    destination: held.destination,
    feeRate: qsbFormatFeeRate((BigInt(held.feeSat) * 1000n) / BigInt(vsize)),
    feeSat: held.feeSat,
    fundingSat: held.outputSat + held.feeSat - held.helper.valueSat,
    helperSat: held.helper.valueSat,
    outputSat: held.outputSat,
    vsize,
  };
};
