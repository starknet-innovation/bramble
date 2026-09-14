/**
 * Small entrypoint adapter that owns ephemeral privacy UI state and supplies
 * the current render-cache values to privacy bindings.
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import type { WalletStatus } from "../../../popup/responses/responses";
import type { BalanceState, SidepanelWallet } from "../../runtime/runtime";
import type { SendIntent } from "../send/send-model";
import { loadPrivacyDisclosure, type PrivacyUiDeps } from "./privacy-disclosure";
import {
  emptyPrivacyDisclosure,
  type PrivacyDisclosureState,
  type PrivacyJourneyState,
} from "./privacy-model";
import { bindPrivacy } from "./privacy-ui";

/**
 * Entrypoint-owned state and navigation supplied to the privacy controller.
 */
export type PrivacyControllerOptions = {
  readonly app: Element | null;
  readonly balances: () => BalanceState;
  readonly navigate: (view: "activity" | "home" | "privacy" | "token-detail") => void;
  /** Opens Send pre-configured for a shield or unshield shortcut. */
  readonly openSend?: (intent: SendIntent) => void;
  readonly paint: () => void;
  readonly preferences: () => WalletPreferences | null;
  readonly status: () => WalletStatus;
  readonly wallet: SidepanelWallet;
};

/**
 * Creates the disclosure/journey controller. Reset is called for every lock,
 * active-account change, and network change.
 */
export const createPrivacyController = (options: PrivacyControllerOptions) => {
  let disclosure: PrivacyDisclosureState = emptyPrivacyDisclosure();
  let generation = 0;
  let journey: PrivacyJourneyState = { stage: "idle" };
  const deps = (): PrivacyUiDeps => ({
    ...options,
    balances: () => {
      const state = options.balances();
      return "balances" in state ? state.balances : [];
    },
    disclosure: () => disclosure,
    generation: () => generation,
    journey: () => journey,
    setDisclosure: (state) => {
      disclosure = state;
    },
    setJourney: (state) => {
      journey = state;
    },
  });
  return {
    bind(): void {
      bindPrivacy(deps());
    },
    disclosure: (): PrivacyDisclosureState => disclosure,
    /**
     * Drops the cached private-balance reading without disturbing an in-flight
     * journey, so the next paint re-reads it. Call after any settled operation
     * that moved private value from outside this controller — a private send
     * confirms in the Send flow, not on the journey surface. Unlike `reset` this
     * does not bump the generation: a concurrent preparation stays valid.
     */
    invalidate(): void {
      disclosure = emptyPrivacyDisclosure();
    },
    journey: (): PrivacyJourneyState => journey,
    /** Retries the same guarded discovery used by the ordinary privacy UI. */
    reload: (): Promise<boolean> => loadPrivacyDisclosure(deps()),
    reset(): void {
      generation += 1;
      disclosure = emptyPrivacyDisclosure();
      journey = { stage: "idle" };
    },
  };
};
