/**
 * `wallet.quoteQsbDeposit`, `wallet.depositQsbVault` and
 * `wallet.resendQsbDeposit` (qsb-app `sdk/client.ts` `submitDeposit`,
 * `sendDeposit`, `resubmitDeposit`), each under the account's QSB lock and
 * over one vault session whose local steps take short queue slots of their
 * own; keeping the signed bytes re-checks, in its slot, that the vault can
 * still take them and no other bytes are kept for it.
 *
 * A deposit is prepared (./qsb-vault-prepare), refused as `quoteChanged`
 * unless its fee is exactly the one the user accepted, signed by Krusty on
 * every input, checked and finalized (`@bramble/qsb/psbt`), checked again
 * against MARA's floor on its signed size, the deployment's gates and a fresh
 * vault list with its reuse scan, kept here durably, and only then sent.
 *
 * The line is the persisted bytes. Every refusal comes before them, and means
 * nothing was sent. After them nothing refuses: whatever happens to the
 * request, the answer is a submission, `uncertain` unless the coordinator's
 * answer is about this vault and consistent with these bytes (`submitted`
 * naming this txid as the vault's funding, `rejected` with no funding), which
 * alone ends the pending deposit. A resend sends only the bytes kept here, or
 * asks the coordinator to resend its own when none are kept; it never signs.
 */
import { finalizeQsbDeposit, type QsbSignedDeposit } from "@bramble/qsb/psbt";
import { isVaultFunding, qsbTransactionVsize } from "@bramble/qsb/transactions";
import type { QsbSubmitAnswer } from "@bramble/qsb/vault-responses";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import type {
  QsbDepositQuote,
  QsbSubmission,
  QsbVaultView,
} from "@bramble/wallet-model/qsb-vaults";
import { requireCoordinatorAccess, requireDepositsOpen } from "./qsb-vault-gates";
import {
  depositableRecord,
  depositableServerVault,
  minerFloorMsat,
  prepareQsbDeposit,
  type QsbDepositableRecord,
  type QsbDepositContext,
  type QsbPreparedDeposit,
} from "./qsb-vault-prepare";
import { failClosed, journalUnavailable, qsbRefusal } from "./qsb-vault-refusals";
import { type QsbVaultDeps, qsbAccessSession, qsbOwnerOf } from "./qsb-vault-session";
import { qsbSubmittedView } from "./qsb-vault-view";

/** A deposit or resend's answer: the vault as the submission left it. */
export type QsbSubmissionReply = {
  readonly submission: QsbSubmission;
  readonly vault: QsbVaultView;
};

// Every action's context, refused with `accessNeeded` before anything else.
const contextOf = async (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
): Promise<QsbDepositContext> => {
  await requireCoordinatorAccess(deps);
  const owner = await qsbOwnerOf(access);
  return { access, deps, owner, session: qsbAccessSession(deps, access, owner) };
};

/** What a deposit of `amountSat` into vault `v` would cost now. Reads only. */
export const quoteQsbDeposit = (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  request: { readonly amountSat: number; readonly v: number },
): Promise<QsbDepositQuote> =>
  failClosed("coordinatorUnavailable", async () => {
    const prepared = await prepareQsbDeposit(await contextOf(deps, access), request);
    return prepared.quote;
  });

// Just before the bytes are kept: the floor on the signed size, the gates,
// and the vault and reuse scan on a fresh list.
const recheck = async (
  context: QsbDepositContext,
  prepared: QsbPreparedDeposit,
  signed: QsbSignedDeposit,
): Promise<void> => {
  const vsize = qsbTransactionVsize(signed.rawTxHex);
  if (vsize === null) throw qsbRefusal("runtimeUnavailable");
  const floor = await minerFloorMsat(context.deps);
  if ((BigInt(prepared.quote.feeSat) * 1000n) / BigInt(vsize) < floor) {
    throw qsbRefusal("quoteChanged");
  }
  requireDepositsOpen(await context.deps.coordinator.config());
  const listed = await context.session.call((token) => context.deps.coordinator.vaults(token));
  if (depositableServerVault(listed, prepared.built, context.owner).id !== prepared.server.id) {
    throw qsbRefusal("notDepositable");
  }
};

// Whether an answer is about this vault and ends the pending deposit `txid`.
const outcomeOf = (
  answer: QsbSubmitAnswer,
  vault: { readonly id: string; readonly scriptHash: string },
  txid: string,
): QsbSubmission => {
  if (answer.vault.id !== vault.id || answer.vault.scriptHash !== vault.scriptHash)
    return "uncertain";
  if (answer.submission === "submitted" && answer.vault.funding?.txid === txid) return "submitted";
  if (answer.submission === "rejected" && answer.vault.funding === null) return "rejected";
  return "uncertain";
};

// Sends kept bytes and settles the pending deposit; never throws.
const sendKept = async (
  context: QsbDepositContext,
  vault: { readonly id: string; readonly scriptHash: string },
  deposit: {
    readonly amountSat: number;
    readonly rawTxHex: string;
    readonly txid: string;
    readonly v: number;
  },
): Promise<QsbSubmission> => {
  const { access, deps, session } = context;
  const submission = await session
    .call((token) => deps.coordinator.fundSubmit(token, vault.id, deposit))
    .then((answer) => outcomeOf(answer, vault, deposit.txid))
    .catch((): QsbSubmission => "uncertain");
  if (submission !== "uncertain") {
    await access.releaseDeposit(deposit.v, deposit.txid).catch(() => undefined);
  }
  return submission;
};

/**
 * Builds, signs and submits a deposit of `amountSat` into vault `v`, whose
 * fee must be exactly `feeSat`. Refuses before anything is kept or sent;
 * once the signed bytes are kept, always answers with a submission.
 */
export const depositQsbVault = async (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  request: { readonly amountSat: number; readonly feeSat: number; readonly v: number },
): Promise<QsbSubmissionReply> => {
  const { context, deposit, prepared } = await failClosed("coordinatorUnavailable", async () => {
    const context = await contextOf(deps, access);
    const prepared = await prepareQsbDeposit(context, request);
    if (prepared.quote.feeSat !== request.feeSat) throw qsbRefusal("quoteChanged");
    // A Krusty refusal to sign, or bytes that fail the checks, are this
    // wallet's own failure: nothing was kept or sent.
    const bytes = await access
      .signDeposit(prepared.psbt.toPSBT(0), prepared.quote.inputCount)
      .catch(() => null);
    const signed = bytes && finalizeQsbDeposit(prepared.psbt, bytes, context.owner.publicKey);
    if (!signed) throw qsbRefusal("runtimeUnavailable");
    await recheck(context, prepared, signed);
    const deposit = { ...signed, amountSat: request.amountSat, v: request.v };
    await access.holdDeposit(deposit);
    return { context, deposit, prepared };
  });
  const submission = await sendKept(context, prepared.server, deposit);
  return { submission, vault: qsbSubmittedView(prepared.record, submission, deposit) };
};

// What a resend sends: the bytes kept here, or the coordinator's own.
type ResendPlan = {
  readonly context: QsbDepositContext;
  readonly kept:
    | {
        readonly amountSat: number;
        readonly rawTxHex: string;
        readonly txid: string;
        readonly v: number;
      }
    | undefined;
  readonly record: QsbDepositableRecord;
  readonly server: {
    readonly funding: { readonly txid: string; readonly valueSat: number } | null;
    readonly id: string;
    readonly scriptHash: string;
  };
};

const planResend = async (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  v: number,
): Promise<ResendPlan> => {
  const record = await depositableRecord(access, v);
  const pending = await access.pendingDeposits();
  if (pending === null) throw journalUnavailable();
  const context = await contextOf(deps, access);
  requireDepositsOpen(await deps.coordinator.config());
  // No new bytes are signed, so the script is not rebuilt: the kept bytes were
  // checked against it before they were kept, and are checked again below.
  const listed = await context.session.call((token) => deps.coordinator.vaults(token));
  const server = listed.vaults.find((vault) => vault.scriptHash === record.scriptHash);
  if (!server || listed.noDeposit.includes(server.id) || server.scriptHex !== record.scriptPubKey) {
    throw qsbRefusal("notDepositable");
  }
  const kept = pending.find((deposit) => deposit.v === v);
  if (
    kept &&
    !isVaultFunding({ ...kept, scriptHex: record.scriptPubKey, valueSat: kept.amountSat })
  ) {
    throw qsbRefusal("runtimeUnavailable");
  }
  if (!kept && !server.funding) throw qsbRefusal("notDepositable");
  return { context, kept, record, server };
};

// Has the coordinator resend its stored bytes; never throws.
const resendStored = async (plan: ResendPlan, txid: string): Promise<QsbSubmission> => {
  const { deps, session } = plan.context;
  return session
    .call((token) => deps.coordinator.fundResubmit(token, plan.server.id))
    .then((answer) => outcomeOf(answer, plan.server, txid))
    .catch((): QsbSubmission => "uncertain");
};

/**
 * Sends vault `v`'s pending deposit again: the same signed bytes, or the
 * coordinator's stored ones when none are kept here. Refuses before sending;
 * once sent, always answers with a submission.
 */
export const resendQsbDeposit = async (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  v: number,
): Promise<QsbSubmissionReply> => {
  const plan = await failClosed("coordinatorUnavailable", () => planResend(deps, access, v));
  if (plan.kept) {
    const submission = await sendKept(plan.context, plan.server, plan.kept);
    return { submission, vault: qsbSubmittedView(plan.record, submission, plan.kept) };
  }
  const funding = plan.server.funding ?? { txid: "", valueSat: 0 };
  const submission = await resendStored(plan, funding.txid);
  const deposit = { amountSat: funding.valueSat, txid: funding.txid };
  return { submission, vault: qsbSubmittedView(plan.record, submission, deposit) };
};
