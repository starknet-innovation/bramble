/**
 * Small entrypoint adapter that owns ephemeral privacy UI state and supplies
 * the current render-cache values to privacy bindings.
 */

import type { WalletStatus } from "../popup/responses";
import type { WalletPreferences } from "../storage/preferences-store";
import { errorMessage, showToast } from "./dom";
import {
  emptyPrivacyDisclosure,
  type PrivacyDisclosureState,
  type PrivacyJourneyState,
} from "./privacy-model";
import { bindShieldSteppers } from "./privacy-stepper";
import { bindPrivacy } from "./privacy-ui";
import type { BalanceState, SidepanelWallet } from "./runtime";

/**
 * Entrypoint-owned state and navigation supplied to the privacy controller.
 */
export type PrivacyControllerOptions = {
  readonly app: Element | null;
  readonly balances: () => BalanceState;
  readonly navigate: (view: "activity" | "home" | "privacy" | "token-detail") => void;
  /** Monotonic milliseconds injected by the entrypoint for stepper pacing. */
  readonly nowMs: () => number;
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
  // Hands a stepper-chosen shield amount to the standard deposit review; a
  // slow preparation is dropped when the account/network scope changed.
  const openShieldReview = (tokenId: string, amount: string): void => {
    const startGeneration = generation;
    const scope = options.status();
    void options.wallet.preparePrivacyDeposit(tokenId, amount).then(
      (preparation) => {
        const current = options.status();
        if (
          generation !== startGeneration ||
          current.activeAccountId !== scope.activeAccountId ||
          current.networkId !== scope.networkId
        ) {
          return;
        }
        journey = { preparation, stage: "deposit-review", tokenId };
        options.navigate("privacy");
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Shielding preparation failed"), "error");
      },
    );
  };
  return {
    bind(): void {
      bindShieldSteppers({ app: options.app, now: options.nowMs, openShieldReview });
      bindPrivacy({
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
    },
    disclosure: (): PrivacyDisclosureState => disclosure,
    journey: (): PrivacyJourneyState => journey,
    reset(): void {
      generation += 1;
      disclosure = emptyPrivacyDisclosure();
      journey = { stage: "idle" };
    },
  };
};
