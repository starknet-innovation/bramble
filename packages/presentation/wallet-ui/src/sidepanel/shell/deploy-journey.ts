/**
 * The deploy screen's state across repaints, kept on the side panel mount.
 *
 * Every paint rebuilds the screen's markup, so state keyed on its controls was
 * lost on each one: the quote ran again, a quoted fee was dropped, and a
 * repaint during the receipt wait re-offered Deploy over a transaction already
 * sent (mc-wallet issue 476). It lives on the mount instead, for one account
 * and network. Leaving the screen drops it, except while a deployment is in
 * flight: a takeover or a visit to Activity then keeps the receipt, so coming
 * back never offers Deploy over a transaction already sent.
 */
import type { FeeEstimate } from "@bramble/starknet/fee-bounds";
import type { DeploySponsorship } from "../runtime/runtime-deploy";
import type { ConfirmationOutcome } from "../shared/confirm-submitted";

/** One account's deploy screen state, shared by every paint of it. */
export type DeployJourney = {
  readonly accountId: string | null;
  readonly stillCurrent: () => boolean;
  fee?: FeeEstimate;
  /** A Deploy press is in flight; a rebuilt screen keeps its control busy. */
  pressed: boolean;
  quoted: boolean;
  /** Why the screen's own quote failed, kept for the screen a repaint rebuilt. */
  quoteNote?: string;
  /** `sponsored`: the relay named the hash, so the chain, not it, decides. */
  receipt?: {
    readonly hash: string;
    outcome: ConfirmationOutcome | null;
    settled: boolean;
    readonly sponsored: boolean;
  };
  /**
   * The background's sponsored-deploy offer (issue 431), asked once per visit after
   * the fee is quoted. "available" makes Deploy the sponsored deploy.
   */
  sponsorship?: DeploySponsorship;
};

const DEPLOY_JOURNEYS = new WeakMap<Element, DeployJourney>();
// Deploy buttons whose listeners are attached. A rebind after a repaint paints
// the live screen's state but must not attach a second set of handlers.
const BOUND = new WeakSet<Element>();

/**
 * The journey for `app`, or a fresh one when the account, network or nothing
 * was there before.
 */
export const deployJourney = (
  app: Element,
  scope: { readonly accountId: string; readonly stillCurrent: () => boolean } | null,
): DeployJourney => {
  const accountId = scope?.accountId ?? null;
  const current = DEPLOY_JOURNEYS.get(app);
  if (current && current.accountId === accountId && current.stillCurrent()) {
    return current;
  }
  const fresh: DeployJourney = {
    accountId,
    pressed: false,
    quoted: false,
    stillCurrent: scope?.stillCurrent ?? (() => true),
  };
  DEPLOY_JOURNEYS.set(app, fresh);
  return fresh;
};

/** Whether `journey` is still the one the mount holds. */
export const isCurrentDeployJourney = (app: Element, journey: DeployJourney): boolean =>
  DEPLOY_JOURNEYS.get(app) === journey;

/**
 * Called when a paint has no deploy screen. The state is dropped unless a
 * deployment is in flight or its receipt is still waiting on the chain.
 */
export const leaveDeployScreen = (app: Element): void => {
  const journey = DEPLOY_JOURNEYS.get(app);
  if (journey && (journey.pressed || (journey.receipt && !journey.receipt.settled))) {
    return;
  }
  DEPLOY_JOURNEYS.delete(app);
};

/** True the first time it is asked about `button`, false afterwards. */
export const firstDeployBinding = (button: Element): boolean => {
  if (BOUND.has(button)) {
    return false;
  }
  BOUND.add(button);
  return true;
};
