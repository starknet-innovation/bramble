/**
 * Call review for SNIP-9 OutsideExecution sign requests (audit 144). Signing one
 * authorizes concrete calls the site may submit later with no second
 * prompt, so it gets the same automatic defences as `wallet_addInvokeTransaction`:
 * the account self-call refusal, the poisoned-recipient refusal, and the risk
 * flags and decoded summaries on the card. At queue time a poisoned recipient
 * is flagged rather than refused, as on the invoke route (Sherlock 140).
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import type { AllowanceRecord } from "@bramble/transactions/allowance-store";
import { standingAllowanceTotals } from "@bramble/transactions/allowances";
import { outsideExecutionCalls } from "@bramble/transactions/outside-execution-calls";
import {
  refuseOnAccountSelfCall,
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { ApprovalRiskFlag } from "@bramble/wallet-protocol/extension-responses";
import { allowanceOwner } from "../portfolio/allowance-recording";
import type { TrustedRecipientSources } from "./trusted-recipients";

/**
 * What the sign card shows for an OutsideExecution: risk flags and one decoded
 * summary per authorized call.
 */
export type OutsideExecutionReview = {
  readonly flags: readonly ApprovalRiskFlag[];
  readonly summaries: readonly string[];
};

/**
 * Reviews typed data against the signing account and its trusted set. Returns
 * `null` for a message that is not an OutsideExecution (plain SNIP-12 signing
 * is unchanged), an `{ error }` refusal for an unreadable envelope, a call to
 * the account contract itself, or a lookalike recipient, and the review
 * otherwise. Callers must not queue or sign on an `{ error }` result. Run it at
 * queue time and again before signing: the address book can gain a contact
 * while the card is open. `allowances` is the recorded allowance log, read the
 * same way the invoke route reads it, so an `increase_allowance` that tops up a
 * standing allowance is flagged on its cumulative total; omitted, the review
 * flags each call on its own amount (refusals never depend on it). Production
 * callers pass preferences enriched by `withTrustedRecipients`, so a lookalike
 * of the user's own accounts or of a recipient this wallet paid is refused here
 * exactly as on the invoke route (audit 163). With `stage: "queue"` a lookalike
 * recipient is not refused: an instant refusal would tell the site which
 * addresses the user saved or paid (Sherlock 140). Its `address-poisoning` flag
 * rides on the review instead, the card offers Deny only, and the `"sign"`
 * stage (the default) still refuses it before any key is used.
 */
export const reviewOutsideExecution = (
  typedData: unknown,
  account: AccountRef,
  preferences: Pick<WalletPreferences, "addressBook" | "dappTokenIds" | "nfts" | "tokens"> &
    Partial<TrustedRecipientSources>,
  allowances: readonly AllowanceRecord[] = [],
  stage: "queue" | "sign" = "sign",
): OutsideExecutionReview | { readonly error: string } | null => {
  const calls = outsideExecutionCalls(typedData);
  if (calls === null) {
    return null;
  }
  if (calls === "malformed") {
    return { error: "invalid typed data" };
  }
  const trusted = verificationContext(account, preferences);
  const report = verifyCalls(
    calls,
    trusted,
    standingAllowanceTotals(allowances, allowanceOwner(account), trusted),
  );
  const refusal =
    refuseOnAccountSelfCall(calls, account.address) ??
    (stage === "sign" ? refuseOnPoisonedRecipient(report) : null);
  if (refusal) {
    return refusal;
  }
  return {
    flags: report.flags.map((flag) => ({ code: flag.code, message: flag.message })),
    summaries: report.calls.map((call) => call.summary),
  };
};
