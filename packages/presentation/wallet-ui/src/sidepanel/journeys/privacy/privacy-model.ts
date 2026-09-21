/**
 * Ephemeral side-panel state for private disclosure and wallet-owned privacy
 * journeys. Nothing here is persisted across lock or extension restart.
 */

import {
  PrivacyBlockerError,
  type PrivacyBlockerKind,
} from "@bramble/wallet-protocol/privacy-blocker";
import type { PreparationProgress } from "./privacy-preparation-job";
import type { PrivacyAccountState, PrivacyPreparation } from "./privacy-runtime";

/**
 * Current shielded-balance discovery state for the selected account and
 * network. Discovery starts automatically for the unlocked active account;
 * `value === null` with no error means it has not completed yet.
 */
export type PrivacyDisclosureState = {
  readonly error: string | null;
  readonly blockerKind?: PrivacyBlockerKind;
  readonly loading: boolean;
  readonly value: PrivacyAccountState | null;
};

/**
 * Why activation cannot proceed right now, reduced to the next thing the user
 * can do about it. Each kind maps to one explained screen with one action, so a
 * Shield control that cannot shield yet still leads somewhere.
 */
export type { PrivacyBlockerKind } from "@bramble/wallet-protocol/privacy-blocker";

/**
 * A blocker and the display-safe reason behind it. The message is what the
 * privileged runtime or the disclosure loader reported; it is rendered escaped
 * and never interpreted beyond the classification below.
 */
export type PrivacyBlocker = {
  readonly kind: PrivacyBlockerKind;
  readonly message: string;
};

/** Reads a validated typed refusal; unclassified errors always offer a service retry. */
export const privacyBlockerFor = (error: unknown): PrivacyBlocker => ({
  kind: error instanceof PrivacyBlockerError ? error.kind : "service",
  message:
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Private journey unavailable",
});

/**
 * Which wait the `preparing` screen is showing. Discovery is the account's
 * registration and private-note read, needed before the entry can decide what
 * it is; proving is the activation proof itself, a tracked background job.
 */
export type PrivacyPreparingStep = "discovering" | "proving";

/**
 * Deterministic checkpoint in the pool-registration journey.
 *
 * Registration is all this surface does. Every movement of value — shielding,
 * unshielding, private sends — is composed in the Send flow as a send between
 * two balances, so the journey has no compose or amount step of its own.
 * `blocked` is the checkpoint before activation: the prerequisite that is not
 * met yet, spelled out with its next action, so no entry point ends in a toast.
 * `preparing` is the wait before either: the entry lands here the moment it is
 * pressed, so a discovery still in flight or a proof that takes minutes is
 * watched on a screen that names its phase and elapsed time, never on a busy
 * button.
 */
export type PrivacyJourneyState =
  | { readonly stage: "idle" }
  | {
      readonly blocker: PrivacyBlocker;
      readonly stage: "blocked";
      readonly tokenId: string;
    }
  | {
      /** Latest poll of the proof job; null before its first poll and while discovering. */
      readonly progress: PreparationProgress | null;
      readonly stage: "preparing";
      readonly step: PrivacyPreparingStep;
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
      /** Latest poll of the submission job, once it has reported one. */
      readonly progress?: PreparationProgress;
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
