/**
 * Stale Argent intents that may have been sent anyway (Sherlock 177).
 *
 * A fully signed intent goes stale when the chain nonce moves past it or a
 * write endpoint answers with a fee rejection. Either can happen after the
 * signed transaction was broadcast: a co-signer holding the same package may
 * have sent it, or the endpoint may have forwarded it before refusing. Before
 * the wallet builds the same calls again, it asks the chain about the stale
 * intent's exact signed hash, so an executed transfer is never re-created at
 * the next nonce and paid twice.
 *
 * The hash alone cannot rule a payment out: co-signers may have sent their own
 * fee-updated version at the stale nonce, with a hash this wallet never saw.
 * So the same calls at a different nonce need the user's explicit say-so
 * unless the stale version is found on chain, which refuses them outright. A
 * stale version at the same nonce needs no say-so: only one can execute.
 */
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import type { ArgentMultisigCall } from "@bramble/starknet/multisig-invoke";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { MultisigOpsDeps } from "./multisig-deps";
import { recoverStaleArgentIntent } from "./multisig-operation-recovery";

/** Refusal when the calls being prepared already went out in a stale version. */
export const ARGENT_INTENT_ALREADY_SENT = "Argent multisig intent was already sent";

/**
 * Refusal until the user confirms preparing calls that a stale version at
 * another nonce may already have sent, through a version this wallet never saw.
 */
export const ARGENT_INTENT_RESEND_UNCONFIRMED =
  "confirm resending calls an earlier Argent multisig intent may have sent";

type PreparedCalls = {
  readonly calls: readonly ArgentMultisigCall[];
  readonly nonce: string;
};

const sameCalls = (
  left: readonly ArgentMultisigCall[],
  right: readonly ArgentMultisigCall[],
): boolean =>
  left.length === right.length &&
  left.every((call, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      call.entrypoint === other.entrypoint &&
      sameFelt(call.contractAddress, other.contractAddress) &&
      call.calldata.length === other.calldata.length &&
      call.calldata.every((value, valueIndex) => sameFelt(value, other.calldata[valueIndex] ?? ""))
    );
  });

const staleIntents = async (
  deps: MultisigOpsDeps,
  accountId: string,
): Promise<readonly ArgentMultisigSigningIntent[]> =>
  (await deps.multisigStore.listIntents()).filter(
    (intent) => intent.accountId === accountId && intent.state === "stale",
  );

const staleSignedIntents = async (
  deps: MultisigOpsDeps,
  accountId: string,
): Promise<readonly ArgentMultisigSigningIntent[]> =>
  (await staleIntents(deps, accountId)).filter(
    (intent) => intent.signatures.length === intent.configSnapshot.threshold,
  );

// What the stale versions of these calls say about sending them at this nonce:
// "sent" when one is on chain, "maybe" when one at another nonce is not.
// A version this wallet holds with too few signatures counts too: co-signers
// can complete and send it from their own copies, and its hash is never looked
// up, so at another nonce it is always a "maybe".
const staleResend = async (
  deps: MultisigOpsDeps,
  accountId: string,
  prepared: PreparedCalls,
): Promise<"maybe" | "sent" | null> => {
  let maybe = false;
  for (const intent of await staleIntents(deps, accountId)) {
    if (!sameCalls(intent.prepared.calls, prepared.calls)) continue;
    const resolution = await recoverStaleArgentIntent(deps, intent);
    if (resolution.kind === "submitted") return "sent";
    // At the same nonce only one of the two can execute, so a stale version
    // that isn't found is no reason to stop. At another nonce, not found (once
    // or for good) and a failed read alike leave a payment possible: the nonce
    // went to something, and only the user can say it wasn't these calls.
    if (!sameFelt(intent.prepared.nonce, prepared.nonce)) maybe = true;
  }
  return maybe ? "maybe" : null;
};

/**
 * Refuses to prepare calls a stale version has sent, and, until `confirmed`,
 * calls a stale version at another nonce may have sent. A found hash moves the
 * stale intent to `submitted` before refusing.
 */
export const refuseResend = async (
  deps: MultisigOpsDeps,
  accountId: string,
  prepared: PreparedCalls,
  confirmed: boolean,
): Promise<{ readonly error: string } | null> => {
  const resend = await staleResend(deps, accountId, prepared);
  if (resend === "sent") return { error: ARGENT_INTENT_ALREADY_SENT };
  if (resend === "maybe" && !confirmed) return { error: ARGENT_INTENT_RESEND_UNCONFIRMED };
  return null;
};

/**
 * Refuses to sign or send calls a stale version is known to have sent. The
 * user confirmed any doubt when the calls were prepared, and a read that fails
 * now must not block the fee-updated version that replaces a stale one.
 */
export const refuseSigningResend = async (
  deps: MultisigOpsDeps,
  accountId: string,
  prepared: PreparedCalls,
): Promise<{ readonly error: string } | null> =>
  (await staleResend(deps, accountId, prepared)) === "sent"
    ? { error: ARGENT_INTENT_ALREADY_SENT }
    : null;

/**
 * Looks up every fully signed stale intent of one account during a refresh, so
 * one sent by another wallet or forwarded before a fee rejection is corrected
 * without the user acting on it. Failures leave the intent stale.
 */
export const recoverStaleIntentsFor = async (
  deps: MultisigOpsDeps,
  accountId: string,
): Promise<void> => {
  for (const intent of await staleSignedIntents(deps, accountId)) {
    await recoverStaleArgentIntent(deps, intent);
  }
};
