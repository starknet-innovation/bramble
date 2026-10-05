/**
 * The private-balance disclosure read and the scope guards every privacy
 * binding shares. Split from ./privacy-ui so the entry-point journey and the
 * activation run can both read through one loader without an import cycle.
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { errorMessage, showToast } from "../../shared/dom";
import type { SendIntent } from "../send/send-model";
import type { PrivacyDisclosureState, PrivacyJourneyState } from "./privacy-model";
import { privacyBlockerFor } from "./privacy-model";

/**
 * Current render state and callbacks consumed by privacy bindings.
 */
export type PrivacyUiDeps = {
  readonly app: Element | null;
  readonly balances: () => readonly TokenBalance[];
  readonly deployment?: () => boolean | null;
  readonly disclosure: () => PrivacyDisclosureState;
  /**
   * Whether the loaded public balances can pay a fee. `null` means the read has
   * not succeeded, which is not the same as a read that found no STRK — only a
   * definite `false` may refuse.
   */
  readonly fundedForFees?: () => boolean | null;
  readonly generation: () => number;
  readonly journey: () => PrivacyJourneyState;
  readonly navigate: (view: "activity" | "home" | "privacy" | "token-detail") => void;
  /** Records that the active account's deployment has been observed on chain. */
  readonly noteDeployed?: () => void;
  /** Opens Send pre-configured for a shield or unshield shortcut. */
  readonly openSend?: (intent: SendIntent) => void;
  readonly paint: () => void;
  readonly preferences: () => WalletPreferences | null;
  readonly setDisclosure: (state: PrivacyDisclosureState) => void;
  readonly setJourney: (state: PrivacyJourneyState) => void;
  /**
   * Start time of a private operation whose settled balance the privacy
   * indexer may not yet reflect, or null when none is being watched. The
   * settle poll re-reads while it is set; a caller that omits it never polls.
   */
  readonly settledAt?: () => number | null;
  /**
   * Drops the settling time above once the settle watch's bounded window has
   * closed, so later repaints bind with no watch rather than re-entering with a
   * stale one. The controller that armed the watch supplies it.
   */
  readonly clearSettledAt?: () => void;
  /**
   * The app's injected wall clock. The settle watch measures its bounded window
   * with it; without a clock the watch is not armed.
   */
  readonly now?: (() => number) | null;
  readonly status: () => WalletStatus;
  readonly wallet: SidepanelWallet;
};

/**
 * The account, network, and controller generation an async privacy result is
 * bound to. Captured before the wait, compared after it.
 */
export type PrivacyAsyncScope = {
  readonly accountId: string | null;
  readonly generation: number;
  readonly networkId: string;
};

/**
 * Snapshots the scope the next async privacy result must still match.
 */
export const captureScope = (deps: PrivacyUiDeps): PrivacyAsyncScope => {
  const status = deps.status();
  return {
    accountId: status.activeAccountId,
    generation: deps.generation(),
    networkId: status.networkId,
  };
};

/**
 * Whether the render state still belongs to a captured scope: no lock, account
 * switch, network switch, or controller reset has happened since.
 */
export const scopeMatches = (deps: PrivacyUiDeps, scope: PrivacyAsyncScope): boolean => {
  const status = deps.status();
  return (
    deps.generation() === scope.generation &&
    status.activeAccountId === scope.accountId &&
    status.networkId === scope.networkId
  );
};

/**
 * Stable identity of a scope, for single-flight work keyed by it.
 */
export const scopeKey = (scope: PrivacyAsyncScope): string =>
  `${scope.networkId}:${scope.accountId ?? ""}:${scope.generation}`;

/**
 * Whether a disclosure reading belongs to the active account and network.
 */
export const disclosureIsCurrent = (deps: PrivacyUiDeps): boolean => {
  const status = deps.status();
  const value = deps.disclosure().value;
  return value?.accountId === status.activeAccountId && value.networkId === status.networkId;
};

// The one read in flight for a scope. A second caller for the same scope joins
// it rather than starting over: the entry point used to restart discovery on
// every click, which threw away a read seconds from landing and started a
// fresh one of up to a minute — with nothing on screen but a dimmed button.
let inFlight: {
  readonly key: string;
  readonly pending: PrivacyDisclosureState;
  readonly promise: Promise<boolean>;
  silent: boolean;
} | null = null;

/**
 * Re-reads the active account's privacy state with account/network staleness
 * guards. Single-flight per scope, so Send's recoverable route error, the
 * auto-discovery on paint, and the activation entry all share one read and
 * never grow a second disclosure path. A failure is toasted unless a caller is
 * about to explain it on a screen of its own (`silent`) — including a caller
 * that joined a read already in flight, whose screen makes the toast redundant.
 */
export const loadPrivacyDisclosure = (
  deps: PrivacyUiDeps,
  options: { readonly silent?: boolean } = {},
): Promise<boolean> => {
  const scope = captureScope(deps);
  const key = scopeKey(scope);
  if (inFlight?.key === key && deps.disclosure() === inFlight.pending) {
    inFlight.silent ||= options.silent === true;
    return inFlight.promise;
  }
  const pending: PrivacyDisclosureState = {
    error: null,
    loading: true,
    value: null,
  };
  deps.setDisclosure(pending);
  deps.paint();
  const record = { key, pending, promise: Promise.resolve(false), silent: options.silent === true };
  const read = async (): Promise<boolean> => {
    try {
      const value = await deps.wallet.loadPrivacyState();
      if (
        deps.disclosure() !== pending ||
        !scopeMatches(deps, scope) ||
        value.accountId !== scope.accountId ||
        value.networkId !== scope.networkId
      ) {
        return false;
      }
      deps.setDisclosure({ error: null, loading: false, value });
      deps.paint();
      return true;
    } catch (error) {
      if (deps.disclosure() === pending && scopeMatches(deps, scope)) {
        const message = errorMessage(error, "Private balances unavailable");
        deps.setDisclosure({
          error: message,
          blockerKind: privacyBlockerFor(error).kind,
          loading: false,
          value: null,
        });
        deps.paint();
        if (!record.silent) showToast(message, "error", deps.app);
      }
      return false;
    } finally {
      if (inFlight === record) inFlight = null;
    }
  };
  inFlight = record;
  record.promise = read();
  return record.promise;
};
