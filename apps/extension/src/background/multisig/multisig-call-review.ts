/**
 * Exact ordinary-call and signer-management review for frozen Argent intents.
 */
import {
  type ArgentMultisigConfigReview,
  requireSafeArgentMultisigCalls,
  reviewArgentMultisigConfigChange,
} from "@mc-wallet/multisig/chain";
import {
  type ArgentMultisigSigningIntent,
  multisigAddressBookEntry,
} from "@mc-wallet/multisig/repository";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@mc-wallet/transactions/verify";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { MultisigOpsDeps } from "./multisig-deps";
import type { ArgentMultisigContext, currentConfigFor } from "./multisig-ops";

/**
 * Validates the exact call set and returns a trusted deterministic summary for
 * the only four permitted stable-0.2 signer-management self-calls.
 */
export const reviewArgentMultisigCalls = async (
  deps: MultisigOpsDeps,
  context: ArgentMultisigContext,
  calls: ArgentMultisigSigningIntent["prepared"]["calls"],
  currentConfig: Awaited<ReturnType<typeof currentConfigFor>>,
): Promise<{ readonly error: string } | ArgentMultisigConfigReview | null> => {
  const normalized = calls.map((call) => ({ ...call, calldata: [...call.calldata] }));
  requireSafeArgentMultisigCalls(context.record.address, normalized);
  const selfCall = normalized.find((call) =>
    sameFelt(call.contractAddress, context.record.address),
  );
  if (selfCall) {
    const review = reviewArgentMultisigConfigChange(
      context.record.address,
      {
        signerPublicKeys: currentConfig.signerPublicKeys,
        threshold: currentConfig.threshold,
      },
      selfCall,
    );
    return review;
  }
  const preferences = await deps.preferencesStore.read();
  return refuseOnPoisonedRecipient(
    verifyCalls(
      normalized,
      verificationContext(context.active.account, {
        ...preferences,
        addressBook: [...preferences.addressBook, multisigAddressBookEntry(context.record)],
      }),
    ),
  );
};
