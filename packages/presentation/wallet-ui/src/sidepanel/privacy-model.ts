/**
 * Ephemeral side-panel state for private disclosure and wallet-owned privacy
 * journeys. Nothing here is persisted across lock or extension restart.
 */

import type { PrivacyAccountState, PrivacyPreparation } from "./privacy-runtime";

/**
 * Current shielded-balance discovery state for the selected account and
 * network. Discovery starts automatically for the unlocked active account;
 * `value === null` with no error means it has not completed yet.
 */
export type PrivacyDisclosureState = {
  readonly error: string | null;
  readonly loading: boolean;
  readonly value: PrivacyAccountState | null;
};

/**
 * Deterministic checkpoint in the pool-registration journey.
 *
 * Registration is all this surface does. Every movement of value — shielding,
 * unshielding, private sends — is composed in the Send flow as a send between
 * two balances, so the journey has no compose or amount step of its own.
 */
export type PrivacyJourneyState =
  | { readonly stage: "idle" }
  | {
      readonly preparation: PrivacyPreparation;
      readonly stage: "activate-review";
      readonly tokenId: string;
    }
  | {
      readonly kind: "register";
      readonly preparation: PrivacyPreparation;
      readonly stage: "working";
      readonly tokenId: string;
    }
  | {
      readonly hash: string;
      readonly kind: "register";
      readonly stage: "success";
      readonly symbol: string;
      readonly tokenId: string;
    }
  | {
      readonly error: string;
      readonly stage: "failure";
      readonly tokenId: string;
    };

/**
 * Returns the disclosure state used at lock, account switch, and first boot.
 */
export const emptyPrivacyDisclosure = (): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: null,
});
