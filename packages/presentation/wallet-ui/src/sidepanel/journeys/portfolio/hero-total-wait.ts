/**
 * The capped wait behind Home's hero total (issue 795). While private
 * discovery that could add to the total is out, the hero reads "—" so the
 * figure does not jump when the private part lands; but a slow privacy service
 * must not hide the portfolio value for long. After `PRIVATE_TOTAL_WAIT_MS`
 * the hero shows the public total, and it updates in place once discovery
 * settles.
 *
 * The wait belongs to one scope (network, account, unlocked session). A new
 * scope starts a fresh wait, and a timer armed for an old scope is cleared and
 * can never mark the new one. Repaints within a scope never restart it. Once
 * the total has been shown for a scope, a later re-read of private balances
 * does not hide it again.
 */

import type { WalletStatus } from "../../../popup/responses/responses";
import { activeAccount } from "../../shared/parts";
import type { StageTimers } from "../../shared/stage-pacer";
import type { PrivacyDisclosureState } from "../privacy/privacy-model";
import { privateTotalPending } from "./home-view";

/** How long the hero holds "—" for pending private discovery before showing the public total. */
export const PRIVATE_TOTAL_WAIT_MS = 3_000;

// Production timers; tests inject manual ones through the shared timer seam.
const platformTimers: StageTimers = {
  clear: (handle) => clearTimeout(handle),
  set: (task, ms) => setTimeout(task, ms),
};

/**
 * The paint loop's handle on the wait. `sync` is called on every paint with
 * the state about to be drawn and returns whether the hero may show the public
 * total while discovery is pending (`privateTotalWaitOver`).
 */
export type HeroTotalWait = {
  readonly sync: (
    status: WalletStatus,
    privacy: PrivacyDisclosureState,
    deployment: boolean | null,
  ) => boolean;
};

/**
 * Creates the wait. `paint` repaints the panel when the wait runs out; it is
 * only called for the scope the timer was armed for.
 */
export const createHeroTotalWait = (options: {
  readonly paint: () => void;
  readonly timers?: StageTimers;
  readonly waitMs?: number;
}): HeroTotalWait => {
  const timers = options.timers ?? platformTimers;
  const waitMs = options.waitMs ?? PRIVATE_TOTAL_WAIT_MS;
  let scope: string | null = null;
  let over = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  return {
    sync: (status, privacy, deployment) => {
      const next =
        status.locked || status.activeAccountId === null
          ? null
          : `${status.networkId}:${status.activeAccountId}`;
      if (next !== scope) {
        stop();
        scope = next;
        over = false;
      }
      if (next === null) return false;
      if (!privateTotalPending(status, activeAccount(status), privacy, deployment)) {
        stop();
        over = true;
      } else if (!over && timer === null) {
        timer = timers.set(() => {
          if (scope !== next) return;
          timer = null;
          over = true;
          options.paint();
        }, waitMs);
      }
      return over;
    },
  };
};
