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
 * Why activation cannot proceed right now, reduced to the next thing the user
 * can do about it. Each kind maps to one explained screen with one action, so a
 * Shield control that cannot shield yet still leads somewhere.
 */
export type PrivacyBlockerKind =
  /** Registration needs a deployed account contract to send from. */
  | "deploy"
  /** The account holds less STRK than the pool fee plus network fee need. */
  | "fund"
  /** Private balances are not offered for this account type. */
  | "ledger"
  /** No privacy pool is configured for the active network. */
  | "network"
  /** A registration is broadcast and waiting on the indexer; nothing to do. */
  | "pending"
  /** Discovery or preparation failed for a reason a retry may clear. */
  | "service";

/**
 * A blocker and the display-safe reason behind it. The message is what the
 * privileged runtime or the disclosure loader reported; it is rendered escaped
 * and never interpreted beyond the classification below.
 */
export type PrivacyBlocker = {
  readonly kind: PrivacyBlockerKind;
  readonly message: string;
};

// The privileged runtime's own wording for each prerequisite, matched by prefix
// so a trailing detail (an amount, a token symbol) does not defeat the match.
// Anything unrecognised is a service condition worth retrying, never a silent
// return: the wrong classification still lands on an explained screen.
const BLOCKER_PATTERNS: readonly (readonly [RegExp, PrivacyBlockerKind])[] = [
  [/^Not enough STRK\b/i, "fund"],
  [/^Deploy this account\b/i, "deploy"],
  [/not configured for this network/i, "network"],
  [/not available for Ledger/i, "ledger"],
  [/already on its way/i, "pending"],
];

/**
 * Classifies a refusal from discovery or registration preparation into the
 * blocker the privacy screen explains.
 */
export const privacyBlockerFor = (message: string): PrivacyBlocker => ({
  kind: BLOCKER_PATTERNS.find(([pattern]) => pattern.test(message))?.[1] ?? "service",
  message,
});

/**
 * Deterministic checkpoint in the pool-registration journey.
 *
 * Registration is all this surface does. Every movement of value — shielding,
 * unshielding, private sends — is composed in the Send flow as a send between
 * two balances, so the journey has no compose or amount step of its own.
 * `blocked` is the checkpoint before activation: the prerequisite that is not
 * met yet, spelled out with its next action, so no entry point ends in a toast.
 */
export type PrivacyJourneyState =
  | { readonly stage: "idle" }
  | {
      readonly blocker: PrivacyBlocker;
      readonly stage: "blocked";
      readonly tokenId: string;
    }
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
