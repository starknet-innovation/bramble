/**
 * Applying a downloaded Bramble update (mc-wallet #708).
 *
 * Chrome downloads extension updates in the background but installs one only
 * when the extension is idle or the browser restarts, so a browser left open
 * for days can keep an old wallet. Listening for `runtime.onUpdateAvailable`
 * lets the wallet apply it sooner, but also means the browser no longer
 * reloads the extension by itself while it is running, so this module always
 * finishes the job:
 * - nothing in use (no wallet page open, nothing pending, no request in
 *   flight): reload straight away;
 * - otherwise: the panel shows "An update is ready" with a restart control,
 *   and the reload runs as soon as everything is idle again.
 * It never reloads while an approval, a signing request, a privacy job or review, or
 * any wallet request is still in progress. A reload locks the wallet, as every
 * update does; nothing stored is touched.
 */

import { readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeResponse } from "./runtime-types";

/** Refusal when a restart is asked for while something is still in progress. */
export const UPDATE_BUSY = "update waits for the request in progress";

// Every wallet page Bramble can have open: the panel, the popup, and tabs
// (onboarding, the options page, the Ledger grant page).
const WALLET_PAGES = ["SIDE_PANEL", "POPUP", "TAB"] as const;

/** The runtime members this module uses; each may be absent (Firefox has no `getContexts`). */
export type UpdateRuntime = {
  readonly getContexts?: (filter: {
    readonly contextTypes: readonly string[];
  }) => Promise<readonly unknown[]>;
  readonly onUpdateAvailable?: { readonly addListener: (listener: () => void) => void };
  readonly reload?: () => void;
};

/** What the background and the message router use. */
export type UpdateReady = {
  /** The panel's "Restart Bramble": reloads unless something is in progress. */
  readonly applyNow: () => RuntimeResponse;
  /** True once an update has downloaded and is waiting to be applied. */
  readonly ready: () => boolean;
  /** Re-checks whether the waiting update can be applied now. */
  readonly settle: () => void;
  /** Counts one wallet request in flight until it settles, then re-checks. */
  readonly track: <T>(work: Promise<T>) => Promise<T>;
};

type UpdateReadyOptions = {
  /** True while an approval, signing request, privacy job or privacy review is pending. */
  readonly isBusy: () => boolean;
  readonly runtime: UpdateRuntime | undefined;
  /** Runs the reload after the reply to the restart request has left. */
  readonly defer?: (run: () => void) => void;
};

const defaultDefer = (run: () => void): void => {
  setTimeout(run, 50);
};

/**
 * Creates the update applier and registers its `onUpdateAvailable` listener.
 * Call it once, at the top level of the background, so an event page keeps
 * the listener. Browser failures are swallowed: an update that cannot be
 * applied now is applied by the browser on its next restart.
 */
export const createUpdateReady = ({
  defer = defaultDefer,
  isBusy,
  runtime,
}: UpdateReadyOptions): UpdateReady => {
  let available = false;
  let inFlight = 0;
  const reload = runtime?.reload;
  const busy = (allowance: number): boolean => isBusy() || inFlight > allowance;

  const settle = (): void => {
    if (!available || !reload || busy(0)) return;
    // Without a way to see open wallet pages (Firefox), the panel's prompt is
    // the path, and the browser applies the update when the page unloads.
    const getContexts = runtime?.getContexts;
    if (!getContexts) return;
    void getContexts({ contextTypes: WALLET_PAGES }).then(
      (open) => {
        if (available && open.length === 0 && !busy(0)) reload();
      },
      () => undefined,
    );
  };

  runtime?.onUpdateAvailable?.addListener(() => {
    available = true;
    settle();
  });

  return {
    applyNow() {
      if (!available || !reload) return { ok: true, restarting: false };
      // The restart request itself is one request in flight.
      if (busy(1)) return { error: UPDATE_BUSY };
      defer(reload);
      return { ok: true, restarting: true };
    },
    ready: () => available,
    settle,
    async track(work) {
      inFlight += 1;
      try {
        return await work;
      } finally {
        inFlight -= 1;
        settle();
      }
    },
  };
};

/** An applier for contexts with no browser runtime (tests, tooling): never ready. */
export const inertUpdateReady: UpdateReady = {
  applyNow: () => ({ ok: true, restarting: false }),
  ready: () => false,
  settle: () => undefined,
  track: (work) => work,
};

/**
 * Handles the panel's update messages; null for any other type. Both are
 * extension-page only (they are not dapp messages, so the router's sender gate
 * refuses them from content). `wallet.updateStatus` only reads;
 * `wallet.applyUpdate` restarts the extension unless something is in progress.
 */
export const handleUpdateOps = (
  updates: UpdateReady,
  messageType: string,
  message: unknown,
): RuntimeResponse | null => {
  if (messageType === "wallet.updateStatus") {
    return readTypeOnlyInput(message, messageType)
      ? { ok: true, updateReady: updates.ready() }
      : { error: "Invalid update request" };
  }
  if (messageType === "wallet.applyUpdate") {
    return readTypeOnlyInput(message, messageType)
      ? updates.applyNow()
      : { error: "Invalid update request" };
  }
  return null;
};
