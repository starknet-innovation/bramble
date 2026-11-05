/**
 * `wallet.releaseQsbWithdrawal` and `wallet.resendQsbWithdrawal`: the user's
 * authorization, the one disclosure, and the submission of exactly the bytes
 * it produced.
 *
 * Before the disclosure every check may refuse and nothing leaves: the
 * password re-entered in the message has opened the vault (the caller);
 * the review is run again on a session that lives at least 15 more minutes,
 * and its digest must be the one the user approved (`reviewChanged`); the fee
 * over the size bound must still clear MARA's floor (`floorRisen`); then the
 * vault service's one release records the exposure durably and only then
 * reveals the 15 preimages.
 *
 * After it, nothing refuses: `finish` assembles the QSB input, its bytes must
 * commit to the intent, Krusty signs the helper alone, its sig is
 * verified and the transaction finalized; the signed bytes are kept durably
 * before `POST …/submit`, and only if their own rate still clears the floor.
 * The answer is the deposit and how the coordinator took it, `uncertain` with
 * the withdrawal `pending` when it said nothing. The preimages are dropped as
 * soon as `finish` returns, whatever it returns; JavaScript cannot wipe the
 * strings themselves. Until signed bytes are kept here (`finish` failed, its
 * bytes did not commit, or the helper sig or its durable write did
 * not complete) there is nothing to resend, so the release answers an
 * unknown outcome, and the deposit stays `ready` for an exact retry of the
 * same disclosure.
 */
import { WalletError } from "@bramble/core/errors";
import {
  ownerP2wpkhScript,
  parseQsbTransaction,
  qsbTransactionVsize,
} from "@bramble/qsb/transactions";
import {
  buildQsbHelperPsbt,
  finalizeQsbWithdrawal,
  type QsbSignedWithdrawal,
  qsbWithdrawalCommits,
} from "@bramble/qsb/withdrawal-psbt";
import type { QsbVaultRecord } from "@bramble/vault/qsb-vault-record";
import type { QsbWithdrawalRecord } from "@bramble/vault/qsb-withdrawal-store";
import type { QsbVaultAccess } from "@bramble/vault/service-types";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import type { QsbWithdrawalSubmission } from "@bramble/wallet-model/qsb-withdrawals";
import { minerFloorMsat, type QsbDepositContext } from "./qsb-vault-prepare";
import { failClosed, failClosedWith, withdrawalRefusal } from "./qsb-vault-refusals";
import type { QsbVaultDeps } from "./qsb-vault-session";
import { qsbVaultView } from "./qsb-vault-view";
import { type QsbReviewedWithdrawal, reviewedWithdrawal } from "./qsb-withdrawal-review";
import { withdrawalContext } from "./qsb-withdrawal-start";
import { keptWithdrawals, withdrawableRecord } from "./qsb-withdrawal-terms";
import { qsbSubmittedWithdrawalView } from "./qsb-withdrawal-view";

/** A release's or resend's answer: how the coordinator took it, and the deposit now. */
export type QsbWithdrawalReply = {
  readonly submission: QsbWithdrawalSubmission;
  readonly vault: QsbVaultView;
};

/**
 * The one answer a release gives when no transaction exists to report: the
 * disclosure is recorded and may have happened, so it is not a refusal.
 */
export const QSB_WITHDRAWAL_OUTCOME_UNKNOWN = "qsb withdrawal outcome unknown";

const outcomeUnknown = (): WalletError => new WalletError(QSB_WITHDRAWAL_OUTCOME_UNKNOWN);

// A funded vault in any state: after disclosure the reply names it regardless.
const ANY_STATE: readonly QsbVaultRecord["state"][] = [
  "allocated",
  "exposed",
  "retired",
  "unknown",
];

// The rate `feeSat` pays over `vsize`, in whole millisatoshis per vB.
const rateMsat = (feeSat: number, vsize: number): bigint =>
  (BigInt(feeSat) * 1000n) / BigInt(vsize);

// Whether `signed` still clears MARA's floor; false when the floor is unknown.
const clearsFloor = async (deps: QsbVaultDeps, held: QsbWithdrawalRecord, rawTxHex: string) => {
  const vsize = qsbTransactionVsize(rawTxHex);
  const floor = await minerFloorMsat(deps).catch(() => null);
  return vsize !== null && floor !== null && rateMsat(held.feeSat, vsize) >= floor;
};

/** What a reply is built over: the session, the withdrawal and its vault as last read. */
type ReplyBasis = {
  readonly access: QsbVaultAccess;
  readonly held: QsbWithdrawalRecord;
  readonly record: QsbVaultRecord;
};

// The deposit as it now stands (as last read, should the journal fail now),
// with its withdrawal as `submission` left it. Never throws.
const replyOf = async (
  basis: ReplyBasis,
  submission: QsbWithdrawalSubmission | null,
  txid: string,
): Promise<QsbWithdrawalReply> => {
  const record = await withdrawableRecord(basis.access, basis.held.v, ANY_STATE).catch(
    () => basis.record,
  );
  return {
    submission: submission ?? "uncertain",
    vault: qsbVaultView(
      record,
      undefined,
      null,
      qsbSubmittedWithdrawalView(basis.held, submission, txid),
    ),
  };
};

// Sends kept bytes once; any failure to hear back is no answer.
const submitKept = async (
  context: QsbDepositContext,
  basis: ReplyBasis,
  signed: QsbSignedWithdrawal,
): Promise<QsbWithdrawalReply> => {
  const { access, deps, session } = context;
  const answer = await session
    .call((token) => deps.coordinator.submitWithdrawal(token, basis.held.jobId, signed.rawTxHex))
    .catch(() => null);
  if (!answer || answer.txid !== signed.txid) return replyOf(basis, null, signed.txid);
  await access.recordWithdrawalOutcome(basis.held.v, answer.status).catch(() => undefined);
  return replyOf(basis, answer.status, signed.txid);
};

// Krusty's helper sig on `raw`, verified and finalized; null otherwise.
const signHelper = async (
  reviewed: QsbReviewedWithdrawal,
  raw: string,
): Promise<QsbSignedWithdrawal | null> => {
  const { access, owner } = reviewed.context;
  const ownerScript = ownerP2wpkhScript(owner.address);
  const psbt =
    ownerScript &&
    buildQsbHelperPsbt({
      fundingPreviousTxHex: reviewed.fundingPreviousTxHex,
      helperPreviousTxHex: reviewed.helperPreviousTxHex,
      helperSat: BigInt(reviewed.held.helper.valueSat),
      ownerScript,
      rawHex: raw,
    });
  if (!psbt) return null;
  const returned = await access.signWithdrawal(psbt.toPSBT());
  return finalizeQsbWithdrawal(psbt, returned, owner.publicKey);
};

// `finish` with the preimages, which are dropped as soon as it returns.
const finished = async (reviewed: QsbReviewedWithdrawal, preimages: string[]): Promise<string> => {
  try {
    const raw = await reviewed.context.deps.runtime.finish(reviewed.prepared, preimages);
    if (
      !qsbWithdrawalCommits({
        manifest: reviewed.manifest,
        rawHex: raw,
        solution: reviewed.solution,
        transaction: reviewed.prepared.transaction,
      })
    ) {
      throw outcomeUnknown();
    }
    return raw;
  } catch {
    throw outcomeUnknown();
  } finally {
    preimages.fill("");
  }
};

// Everything after the disclosure: never a refusal.
const afterDisclosure = async (
  reviewed: QsbReviewedWithdrawal,
  preimages: string[],
): Promise<QsbWithdrawalReply> => {
  const { access, deps } = reviewed.context;
  const { held } = reviewed;
  const basis: ReplyBasis = { access, held, record: { ...reviewed.record, state: "exposed" } };
  const raw = await finished(reviewed, preimages);
  const txid = parseQsbTransaction(raw)?.id;
  if (!txid) throw outcomeUnknown();
  // Until signed bytes are kept, nothing exists to resend: an unknown
  // outcome, and the deposit stays ready for an exact retry.
  const signed = await signHelper(reviewed, raw).catch(() => null);
  if (!signed || signed.txid !== txid) throw outcomeUnknown();
  const kept = await access.keepSignedWithdrawal(held.v, signed).then(
    () => true,
    () => false,
  );
  if (!kept) throw outcomeUnknown();
  if (!(await clearsFloor(deps, held, signed.rawTxHex))) return replyOf(basis, null, txid);
  return submitKept(reviewed.context, basis, signed);
};

/**
 * Releases deposit `v`'s withdrawal as reviewed (`digest`), signs and submits
 * it. The vault session is over the password the user re-entered.
 */
export const releaseQsbWithdrawal = async (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  request: { readonly digest: string; readonly v: number },
): Promise<QsbWithdrawalReply> => {
  const bindingRefused = () => withdrawalRefusal("bindingRefused");
  const { reviewed, preimages } = await failClosedWith(bindingRefused, async () => {
    const checked = await reviewedWithdrawal(deps, access, request.v);
    if (checked.review.digest !== request.digest) throw withdrawalRefusal("reviewChanged");
    const floor = await minerFloorMsat(deps);
    if (rateMsat(checked.held.feeSat, checked.review.vsize) < floor) {
      throw withdrawalRefusal("floorRisen");
    }
    const released = await access.releasePreimages({
      digest: request.digest,
      round0: checked.prepared.round0,
      round1: checked.prepared.round1,
      transaction: checked.prepared.transaction,
      v: request.v,
    });
    return { preimages: [...released], reviewed: checked };
  });
  return afterDisclosure(reviewed, preimages);
};

/**
 * Sends deposit `v`'s kept withdrawal again: the same bytes, never new ones,
 * refused (nothing sent) while their rate is under MARA's floor.
 */
export const resendQsbWithdrawal = (
  deps: QsbVaultDeps,
  access: QsbVaultAccess,
  v: number,
): Promise<QsbWithdrawalReply> =>
  failClosed("runtimeUnavailable", async () => {
    const context = await withdrawalContext(deps, access);
    const held = (await keptWithdrawals(access)).find((entry) => entry.v === v);
    if (!held?.signed) throw withdrawalRefusal("notReady");
    const record = await withdrawableRecord(access, v, ANY_STATE);
    if (!(await clearsFloor(deps, held, held.signed.rawTxHex))) {
      throw withdrawalRefusal("floorRisen");
    }
    return submitKept(context, { access, held, record }, held.signed);
  });
