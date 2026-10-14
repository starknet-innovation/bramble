/**
 * Ephemeral side-panel state for private disclosure and wallet-owned privacy
 * journeys. Nothing here is persisted across lock or extension restart.
 */

import { friendlyNetworkError } from "@bramble/core/network-error";
import {
  PrivacyBlockerError,
  type PrivacyBlockerKind,
} from "@bramble/wallet-protocol/privacy-blocker";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import { friendlyError } from "../../runtime/friendly-error";

// The sentence a service blocker shows when the lane's own reason is plumbing:
// the same one the wallet already uses when the private services are down.
const PRIVACY_SERVICE_FALLBACK = friendlyError("strk20 services unavailable").message;

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

/**
 * A network without a pool, or a Ledger account, cannot register. Those
 * answers stay ahead of a deployment offer: paying to deploy would not make
 * privacy available.
 */
export const privacyIneligibleKind = (
  privacy: PrivacyDisclosureState,
): "ledger" | "network" | null =>
  privacy.blockerKind === "ledger" || privacy.blockerKind === "network"
    ? privacy.blockerKind
    : null;

/**
 * Registration that has already been broadcast or indexed only happens for an
 * account that exists on chain. A stale "undeployed" cache must not hide that.
 */
export const deploymentKnownFromPrivacy = (
  deployment: boolean | null,
  privacy: PrivacyDisclosureState,
): boolean | null => {
  const registration = privacy.value?.registration;
  if (registration === "pending" || registration === "registered") {
    return true;
  }
  return deployment;
};

/**
 * Reads a validated typed refusal; unclassified errors always offer a service
 * retry. A curated refusal (deploy, fund, ledger, network, pending) keeps the
 * background's sentence. A "service" refusal wraps whatever the privacy lane
 * threw, so its text is translated before it can reach the blocker screen
 * (issue 652).
 */
export const privacyBlockerFor = (error: unknown): PrivacyBlocker => {
  const kind = error instanceof PrivacyBlockerError ? error.kind : "service";
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Private journey unavailable";
  return {
    kind,
    message:
      kind === "service"
        ? (friendlyNetworkError(raw) ?? friendlyError(raw, PRIVACY_SERVICE_FALLBACK).message)
        : raw,
  };
};

/**
 * Which wait the `preparing` screen is showing. Discovery is the account's
 * registration and private-note read, needed before the entry can decide what
 * it is; proving is the activation proof itself, a tracked background job.
 */
export type PrivacyPreparingStep = "discovering" | "proving";

/**
 * How a not-completed private write is shown. `warning` is for a submission
 * whose reply was lost: it may already be on chain, so it is not a failure and
 * must not lead with the retry a failure offers (issue 382).
 */
export type PrivacyOutcomeSeverity = "danger" | "warning";

/**
 * Classifies a rejected private write for display. A {@link SubmissionUnknownError}
 * means the write left the wallet and its outcome could not be established, so
 * it is a warning; anything else is a determinate failure. Kept a total function
 * of the error so the severity is decided once, at the origin, rather than
 * inferred from the message at paint time.
 */
export const privacyOutcomeSeverity = (error: unknown): PrivacyOutcomeSeverity =>
  error instanceof SubmissionUnknownError ? "warning" : "danger";

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
      readonly severity: PrivacyOutcomeSeverity;
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
