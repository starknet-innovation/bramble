/**
 * Debounced, cached lookup of whether a send recipient can receive into a
 * private balance.
 *
 * The answer comes from the pool rather than from discovery, so it is a network
 * round trip per address: cached per recipient for the life of the Send journey,
 * and debounced so typing an address does not issue a request per keystroke.
 * An in-flight answer reads as `unknown`, which gates as a wait rather than a
 * refusal — a re-check must never flip an enabled control off under the user.
 */

import type { PoolRegistration } from "@mc-wallet/transactions/send-routes";
import type { SidepanelWallet } from "./runtime";

const CHECK_DEBOUNCE_MS = 400;

/**
 * Collaborators for the recipient registration registry.
 */
export type RecipientStatusDeps = {
  /** Called when an answer lands, so the caller can re-gate. */
  readonly onSettled: () => void;
  readonly wallet: SidepanelWallet;
};

/**
 * A per-journey cache of recipient answers.
 */
export type RecipientStatusRegistry = {
  /** Starts a check for this recipient unless one has already been answered. */
  readonly check: (tokenId: string, recipient: string) => void;
  /** The cached answer, or `unknown` while none has landed. */
  readonly status: (recipient: string) => PoolRegistration;
};

/**
 * Creates the registry. One per Send binding, so switching accounts starts from
 * no cached answers.
 */
export const createRecipientStatus = (deps: RecipientStatusDeps): RecipientStatusRegistry => {
  const answers = new Map<string, PoolRegistration>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    check(tokenId, recipient) {
      if (answers.has(recipient)) {
        return;
      }
      answers.set(recipient, "unknown");
      if (timer !== null) {
        clearTimeout(timer);
        // Drop the superseded marker so an abandoned address is not left stuck
        // on `unknown` if the user comes back to it.
        for (const [address, answer] of answers) {
          if (answer === "unknown" && address !== recipient) {
            answers.delete(address);
          }
        }
      }
      timer = setTimeout(() => {
        void deps.wallet.loadPrivacyRecipientStatus(tokenId, recipient).then(
          (registration) => {
            answers.set(recipient, registration);
            deps.onSettled();
          },
          () => {
            // A failed lookup is forgotten rather than cached as a refusal, so
            // the next interaction retries it.
            answers.delete(recipient);
            deps.onSettled();
          },
        );
      }, CHECK_DEBOUNCE_MS);
    },
    status(recipient) {
      return answers.get(recipient) ?? "unknown";
    },
  };
};
