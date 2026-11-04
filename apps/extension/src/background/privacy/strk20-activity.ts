/** Shared activity identities for public STRK20 operations. */

import { type ActivityEntry, systemClock } from "@bramble/transactions/activity";

/**
 * Activity summary recorded for a pool registration. Pending-registration
 * derivation matches this exact value, including dapp-initiated registration.
 */
export const STRK20_REGISTRATION_SUMMARY = "Activate private balances";

/**
 * Activity summary for a first shield that registers in the same transaction
 * (#789): one row, one hash, naming both halves of what it did.
 */
export const strk20FirstShieldSummary = (value: string): string =>
  `${STRK20_REGISTRATION_SUMMARY} and shield ${value}`;

const FIRST_SHIELD_PREFIX = `${STRK20_REGISTRATION_SUMMARY} and shield `;

/** Whether an activity summary records a registration, alone or with a shield. */
export const isStrk20RegistrationSummary = (summary: string): boolean =>
  summary === STRK20_REGISTRATION_SUMMARY || summary.startsWith(FIRST_SHIELD_PREFIX);

/**
 * How long a broadcast registration is trusted over the privacy indexer. The
 * indexer reflects a registration seconds to minutes after Starknet accepts it;
 * past this window a still-invisible registration reads as absent again, so an
 * attempt that truly never landed leaves the user able to retry rather than
 * locked out of the flow forever.
 */
const REGISTRATION_PENDING_WINDOW_MS = 30 * 60_000;

/**
 * A registration the privacy indexer cannot see yet. Derived from the activity
 * log rather than stored separately: the registration is already recorded there
 * with its hash, and background reconciliation already advances that entry, so a
 * rejected or reverted attempt drops out of this check on its own. A first
 * shield that registered in the same transaction counts too.
 */
export const hasPendingRegistration = async (
  deps: {
    readonly activity: { readonly list: () => Promise<readonly ActivityEntry[]> };
    readonly now?: () => number;
  },
  context: {
    readonly accountContext: {
      readonly account: { readonly id: string; readonly networkId: string };
    };
  },
): Promise<boolean> => {
  const now = (deps.now ?? systemClock)();
  const account = context.accountContext.account;
  const entries = await deps.activity.list();
  return entries.some(
    (entry) =>
      isStrk20RegistrationSummary(entry.summary) &&
      entry.accountId === account.id &&
      entry.networkId === account.networkId &&
      entry.status !== "rejected" &&
      entry.status !== "reverted" &&
      now - entry.submittedAt < REGISTRATION_PENDING_WINDOW_MS,
  );
};
