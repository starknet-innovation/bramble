/**
 * The one recipient policy every STRK20 privacy route applies, in one module so
 * the wallet's own pool routes and the dapp-facing prepare/invoke routes cannot
 * hold different opinions about the same recipient.
 *
 * Trust boundary: the actions are untrusted — a side-panel message or a dapp
 * request — and are checked here BEFORE any preparation, approval prompt, proof,
 * or submission exists. Everything a batch would pay is reduced to a list of
 * {@link Call}s and run through the shared {@link verifyCalls}, so the private
 * routes inherit the exact rule, trusted set, and wording the public ERC20 send,
 * the NFT send, the swap, and the dapp invoke already apply (MCW-V09-109).
 *
 * Failure behavior: a non-null result is a refusal the caller must return
 * unchanged without preparing, queueing, or submitting anything. `null` means no
 * recipient in the batch mimics an address this account trusts.
 */

import { strk20CallToInvoke } from "@bramble/privacy/service";
import {
  refuseOnPoisonedRecipient,
  verificationContext,
  verifyCalls,
} from "@bramble/transactions/verify";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { ApprovalRiskFlag } from "@bramble/wallet-protocol/extension-responses";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { Call } from "starknet";

/**
 * The preferences the trusted set is built from, taken from the shared
 * {@link verificationContext} rather than restated, so this module can never
 * scope the trusted set differently from the surface that defines it.
 */
export type Strk20TrustedPreferences = Parameters<typeof verificationContext>[1];

/**
 * One recipient-bearing move: who is paid, and in which token.
 */
export type Strk20RecipientTarget = {
  readonly recipient: string;
  readonly token: string;
};

// A move whose recipient the action states outright (`deposit`, `transfer`,
// `withdraw`) is judged as the ERC20 `transfer` it is: the verifier's recipient
// rules key off a decoded transfer's recipient and none of them depend on the
// amount, so a zero-amount probe of the token being moved carries every fact
// they read.
const recipientProbeCall = (target: Strk20RecipientTarget): Call => ({
  calldata: [target.recipient, "0x0", "0x0"],
  contractAddress: target.token,
  entrypoint: "transfer",
});

/**
 * Every call a batch of privacy actions is judged on, in batch order.
 *
 * A flat `invoke` has no entry point, so every concrete calldata felt is checked
 * conservatively as a possible recipient. That can refuse an amount crafted to
 * look like a saved address, but it cannot let an opaque call hide a recipient.
 *
 * A sixth action variant cannot slip past silently: the final branch narrows to
 * the recipient-bearing variants and reads `recipient`/`token` off them, so any
 * new shape has to be given a decision here before it type-checks.
 */
const strk20PolicyCalls = (actions: readonly Strk20Action[]): readonly Call[] =>
  actions.flatMap((action) => {
    if (action.type === "subaccount_invoke") {
      // Judged on its real calls rather than a probe: each is a spec
      // INVOKE_CALL with a contract, an entry point, and felt calldata —
      // exactly what `wallet.addInvokeTransaction` accepts and what the shared
      // decoder reads — and the SDK hands them to the anonymizer verbatim. So a
      // poisoned recipient refuses identically whichever route the site picks.
      return action.calls.map(strk20CallToInvoke);
    }
    if (action.type === "invoke") {
      return action.calldata.map((recipient) =>
        recipientProbeCall({ recipient, token: action.contract }),
      );
    }
    return action.recipient === undefined
      ? []
      : [recipientProbeCall({ recipient: action.recipient, token: action.token })];
  });

const refuseOnPoisonedCalls = (
  account: AccountRef,
  preferences: Strk20TrustedPreferences,
  calls: readonly Call[],
): { readonly error: string } | null =>
  refuseOnPoisonedRecipient(verifyCalls(calls, verificationContext(account, preferences)));

/**
 * Refuses a batch in which any recipient visually mimics an address this account
 * trusts, with the verifier's own wording so the user reads the same sentence
 * whichever screen or site the request came from.
 *
 * Returns `null` when every recipient is clear. An empty target list is clear by
 * construction: a batch that pays nobody has no recipient to poison.
 */
export const refusePoisonedStrk20Recipients = (
  account: AccountRef,
  preferences: Strk20TrustedPreferences,
  targets: readonly Strk20RecipientTarget[],
): { readonly error: string } | null =>
  refuseOnPoisonedCalls(account, preferences, targets.map(recipientProbeCall));

/**
 * The action-list form of {@link refusePoisonedStrk20Recipients}: the single
 * gate the dapp-facing prepare and invoke routes apply, at request time and
 * again at execution time, so a contact saved between consent and submission
 * still refuses.
 */
export const refusePoisonedStrk20Actions = (
  account: AccountRef,
  preferences: Strk20TrustedPreferences,
  actions: readonly Strk20Action[],
): { readonly error: string } | null =>
  refuseOnPoisonedCalls(account, preferences, strk20PolicyCalls(actions));

/**
 * The approval-flag form of {@link refusePoisonedStrk20Actions} for the
 * dapp-facing routes. A site's request is queued with this flag rather than
 * refused on arrival: an instant refusal told the site which addresses the user
 * has saved or paid (Sherlock 140). The card then offers Deny only, and the
 * execution-time refusal stays in place.
 */
export const poisonedStrk20ActionFlags = (
  account: AccountRef,
  preferences: Strk20TrustedPreferences,
  actions: readonly Strk20Action[],
): readonly ApprovalRiskFlag[] => {
  const refusal = refusePoisonedStrk20Actions(account, preferences, actions);
  return refusal ? [{ code: "address-poisoning", message: refusal.error }] : [];
};
