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
 * Deterministic checkpoint in the registration or shielding journey.
 */
export type PrivacyJourneyState =
  | { readonly stage: "idle" }
  | {
      readonly preparation: PrivacyPreparation;
      readonly stage: "activate-review" | "deposit-review";
      readonly tokenId: string;
    }
  | {
      /**
       * What the user has composed so far. All three live here rather than in
       * the DOM because the card is rebuilt by every repaint — picking a
       * destination, deriving an account, a background balance refresh — and a
       * DOM-only card would snap back to an empty "Shield" mid-edit.
       *
       * `destinationAccountId` is the owned account a withdrawal lands in
       * (absent means the active account); `unshielding` is which balance is the
       * source; `amount` is the typed amount.
       */
      readonly amount?: string;
      readonly destinationAccountId?: string;
      readonly stage: "compose";
      readonly tokenId: string;
      readonly unshielding?: boolean;
    }
  | {
      readonly kind: "deposit" | "register" | "withdraw";
      readonly preparation: PrivacyPreparation;
      readonly stage: "working";
      readonly tokenId: string;
    }
  | {
      readonly hash: string;
      readonly kind: "deposit" | "register" | "withdraw";
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
