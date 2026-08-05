/**
 * Bindings for the unshield destination block: reveal the owned-account list,
 * pick one, or derive a fresh account to withdraw into. The selection is written
 * to journey state rather than the DOM, because deriving an account refreshes
 * wallet status and repaints the panel — a DOM-held choice would be silently
 * lost at exactly the moment the user made it.
 */

import type { WalletStatus } from "../popup/responses";
import type { WalletPreferences } from "../storage/preferences-store";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { resolveWithdrawDestination, withdrawDestinationAddress } from "./privacy-destination";
import type { PrivacyJourneyState } from "./privacy-model";
import type { SidepanelWallet } from "./runtime";

/**
 * Collaborators needed to change or create a withdrawal destination.
 */
export type WithdrawDestinationDeps = {
  readonly app: Element | null;
  readonly journey: () => PrivacyJourneyState;
  readonly paint: () => void;
  readonly preferences: () => WalletPreferences | null;
  readonly setJourney: (state: PrivacyJourneyState) => void;
  readonly status: () => WalletStatus;
  readonly wallet: SidepanelWallet;
};

/**
 * Resolves the address an unshield should pay out to: the typed override when
 * present, otherwise the journey's selected account, otherwise the active one.
 * Undefined only when the wallet holds no account on this network, which the
 * caller must treat as a refusal rather than a silent fallback.
 */
export const withdrawRecipientFor = (
  deps: Pick<WithdrawDestinationDeps, "journey" | "status">,
  typed: string,
): string | undefined => {
  const status = deps.status();
  const journey = deps.journey();
  return withdrawDestinationAddress(
    typed,
    resolveWithdrawDestination({
      accounts: status.accounts,
      activeAccountId: status.activeAccountId,
      networkId: status.networkId,
      selectedAccountId: journey.stage === "compose" ? journey.destinationAccountId : undefined,
    }),
  );
};

// Rewrites the compose stage's destination, leaving every other journey stage
// untouched: a late click after the stage advanced must not resurrect compose.
// Spreads the existing stage so the direction and typed amount survive the
// repaint this triggers — picking a destination must not reset the card the user
// was already filling in.
const selectDestination = (deps: WithdrawDestinationDeps, accountId: string): void => {
  const journey = deps.journey();
  if (journey.stage !== "compose") {
    return;
  }
  deps.setJourney({ ...journey, destinationAccountId: accountId });
  deps.paint();
};

/**
 * Binds the destination controls present in the current render. Safe to call on
 * every paint and for every journey stage; it no-ops when the block is absent.
 */
export const bindWithdrawDestination = (deps: WithdrawDestinationDeps): void => {
  const root = deps.app?.querySelector<HTMLElement>("[data-privacy-recipient-row]");
  if (!root) {
    return;
  }
  const options = root.querySelector<HTMLElement>("[data-privacy-destination-options]");
  const toggle = root.querySelector<HTMLButtonElement>("[data-privacy-destination-toggle]");
  toggle?.addEventListener("click", () => {
    const hidden = options?.hasAttribute("hidden") ?? true;
    options?.toggleAttribute("hidden", !hidden);
    toggle.setAttribute("aria-expanded", String(hidden));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-privacy-destination-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const accountId = button.dataset["privacyDestinationPick"];
      if (accountId) {
        selectDestination(deps, accountId);
      }
    });
  });
  const create = root.querySelector<HTMLButtonElement>("[data-privacy-destination-new]");
  create?.addEventListener("click", () => {
    const networkId = deps.status().networkId;
    buttonBusy(create, true);
    void deps.wallet.addAccount(networkId).then(
      (accountId) => {
        // The account exists in the vault now; the status refresh that follows
        // brings it into `status.accounts`, and the selection already points at
        // it so the repaint renders the new destination directly.
        selectDestination(deps, accountId);
        buttonBusy(create, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Could not create an account"), "error");
        buttonBusy(create, false);
      },
    );
  });
};
