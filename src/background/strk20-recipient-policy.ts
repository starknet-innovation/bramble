/**
 * The one recipient policy every STRK20 privacy route applies, in one module so
 * the wallet's own pool routes and the dapp-facing prepare/invoke routes cannot
 * hold different opinions about the same recipient.
 *
 * Trust boundary: the actions are untrusted — a side-panel message or a dapp
 * request — and are checked here BEFORE any preparation, approval prompt, proof,
 * or submission exists. The probe is a zero-amount ERC20 `transfer` of the token
 * being moved, run through the shared {@link verifyCalls}: the verifier's
 * recipient rules key off a decoded transfer's recipient and none of them depend
 * on the amount, so going through it rather than re-deriving a lookalike test
 * here is what makes the private routes inherit the exact rule, trusted set, and
 * wording the public ERC20 send, the NFT send, the swap, and the dapp invoke
 * already apply (MCW-V09-109).
 *
 * Failure behavior: a non-null result is a refusal the caller must return
 * unchanged without preparing, queueing, or submitting anything. `null` means no
 * recipient in the batch mimics an address this account trusts.
 */

import type { Strk20Action } from "../starknet/strk20/schemas";
import { refuseOnPoisonedRecipient, verificationContext, verifyCalls } from "../starknet/verify";
import type { AccountRef } from "../storage/vault-schema";

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

/**
 * Every recipient a batch of privacy actions would pay, in batch order.
 *
 * A `deposit` names one only when it credits somebody else, and `invoke` /
 * `subaccount_invoke` name none at all — they carry contract calldata, which the
 * approval review decodes; inventing a recipient from an opaque calldata slot
 * here would be a guess, and this policy never guesses.
 */
export const strk20RecipientTargets = (
  actions: readonly Strk20Action[],
): readonly Strk20RecipientTarget[] =>
  actions.flatMap((action) => {
    if (action.type === "invoke" || action.type === "subaccount_invoke") {
      return [];
    }
    return action.recipient === undefined
      ? []
      : [{ recipient: action.recipient, token: action.token }];
  });

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
  refuseOnPoisonedRecipient(
    verifyCalls(
      targets.map((target) => ({
        calldata: [target.recipient, "0x0", "0x0"],
        contractAddress: target.token,
        entrypoint: "transfer",
      })),
      verificationContext(account, preferences),
    ),
  );

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
  refusePoisonedStrk20Recipients(account, preferences, strk20RecipientTargets(actions));
