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
 */
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import type { ArgentMultisigCall } from "@bramble/starknet/multisig-invoke";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { MultisigOpsDeps } from "./multisig-deps";
import { recoverStaleArgentIntent } from "./multisig-operation-recovery";

/** Refusal when the calls being prepared already went out in a stale version. */
export const ARGENT_INTENT_ALREADY_SENT = "Argent multisig intent was already sent";

/** Refusal when the chain could not say whether a stale version went out. */
export const ARGENT_INTENT_SEND_UNKNOWN =
  "could not check whether the earlier Argent multisig intent was sent";

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

const staleSignedIntents = async (
  deps: MultisigOpsDeps,
  accountId: string,
): Promise<readonly ArgentMultisigSigningIntent[]> =>
  (await deps.multisigStore.listIntents()).filter(
    (intent) =>
      intent.accountId === accountId &&
      intent.state === "stale" &&
      intent.signatures.length === intent.configSnapshot.threshold,
  );

/**
 * Refuses to prepare calls identical to a fully signed stale intent unless the
 * chain positively reports that intent's signed hash as never sent. A found
 * hash moves the stale intent to `submitted` before refusing; a failed read
 * refuses too, because "cannot tell" must not become a second payment.
 */
export const refuseResendOfStaleIntent = async (
  deps: MultisigOpsDeps,
  accountId: string,
  calls: readonly ArgentMultisigCall[],
): Promise<{ readonly error: string } | null> => {
  for (const intent of await staleSignedIntents(deps, accountId)) {
    if (!sameCalls(intent.prepared.calls, calls)) continue;
    const resolution = await recoverStaleArgentIntent(deps, intent);
    if (resolution.kind === "submitted") return { error: ARGENT_INTENT_ALREADY_SENT };
    if (resolution.kind === "unknown") return { error: ARGENT_INTENT_SEND_UNKNOWN };
  }
  return null;
};

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
