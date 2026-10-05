/**
 * Exact ordinary-call and signer-management review for frozen Argent intents.
 */
import {
  type ArgentMultisigConfigReview,
  type ArgentMultisigPublicConfig,
  MULTISIG_LIMITS,
  requireSafeArgentMultisigCalls,
  reviewArgentMultisigConfigChange,
} from "@bramble/multisig/chain";
import {
  type ArgentMultisigSigningIntent,
  multisigAddressBookEntry,
} from "@bramble/multisig/repository";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import { sameFelt } from "@bramble/wallet-model/networks";
import { observedVaultAccountAddresses } from "../runtime/runtime-state";
import { withTrustedRecipients } from "../transactions/trusted-recipients";
import type { MultisigOpsDeps } from "./multisig-deps";
import type { ArgentMultisigContext } from "./multisig-ops";

/**
 * Trusted local description of one validated frozen call set. Invalid or
 * poisoned input never produces this shape; the reviewer returns an error.
 */
export type ArgentMultisigCallReview = {
  readonly config?: ArgentMultisigConfigReview;
  readonly summary: string;
};

import { normalizedArgentMultisigCalls } from "./multisig-inputs";

/**
 * Validates the exact call set and returns a trusted deterministic bounded
 * summary. Poisoned recipients and invalid config self-calls fail closed.
 */
export const reviewArgentMultisigCalls = async (
  deps: MultisigOpsDeps,
  context: ArgentMultisigContext,
  calls: ArgentMultisigSigningIntent["prepared"]["calls"],
  currentConfig: ArgentMultisigPublicConfig | null,
): Promise<{ readonly error: string } | ArgentMultisigCallReview> => {
  const normalized = normalizedArgentMultisigCalls(calls);
  requireSafeArgentMultisigCalls(context.record.address, normalized);
  const selfCall = normalized.find((call) =>
    sameFelt(call.contractAddress, context.record.address),
  );
  if (selfCall) {
    if (!currentConfig) {
      return {
        error: "Signer-management intents require the complete current public signer configuration",
      };
    }
    const review = reviewArgentMultisigConfigChange(
      context.record.address,
      {
        signerPublicKeys: currentConfig.signerPublicKeys,
        threshold: currentConfig.threshold,
      },
      selfCall,
    );
    return { config: review, summary: review.summary };
  }
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    await observedVaultAccountAddresses(deps.wallet, deps.session),
  );
  const report = verifyCalls(
    normalized,
    verificationContext(context.record, {
      ...preferences,
      addressBook: [...preferences.addressBook, multisigAddressBookEntry(context.record)],
    }),
  );
  const refusal = refuseOnPoisonedRecipient(report);
  if (refusal) return refusal;
  const first = report.calls[0]?.summary ?? "Review Argent multisig call";
  const suffix = report.calls.length > 1 ? ` (+${report.calls.length - 1} more)` : "";
  return { summary: `${first}${suffix}`.slice(0, MULTISIG_LIMITS.summaryLength) };
};
