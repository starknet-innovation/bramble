/**
 * Reader-facing sentences for private-balance diagnostics, consumed by the
 * main table in ./friendly-error-copy. Split from it by the size budget; same
 * contract — exact lowercase diagnostic to sentence.
 */
import { PRIVATE_SERVICES_UNAVAILABLE_NOTICE } from "@bramble/wallet-protocol/privacy-blocker";
import { SUBMISSION_UNKNOWN } from "./friendly-error-shared";

const ACTIVATE_FIRST = "Activate private balances first.";
const DEPLOY_FIRST = "Deploy this account first.";

/** Private-balance entries merged into ERROR_COPY, in table order. */
export const PRIVACY_ERROR_COPY: readonly (readonly [string, string])[] = [
  ["private balances unavailable", "Couldn't load private balances. Try again."],
  ["strk20 services unavailable", "Private balances are unavailable right now. Try again shortly."],
  // The approved line a site's private request already shows for the same
  // fact (errors audit F7).
  [
    "strk20 services unavailable: no shadow account anonymizer is configured for this network",
    PRIVATE_SERVICES_UNAVAILABLE_NOTICE,
  ],
  ["private balances are already active", "Private balances are already active."],
  [
    "private balances are not available for ledger accounts",
    "Private balances aren't available for Ledger accounts.",
  ],
  [
    "private balances are not configured for this network",
    "Private balances aren't set up on this network.",
  ],
  ["activate private balances before sending privately", ACTIVATE_FIRST],
  ["activate private balances before unshielding", ACTIVATE_FIRST],
  ["deploy this account before activating private balances", DEPLOY_FIRST],
  ["deploy this account before submitting a public private deposit", DEPLOY_FIRST],
  ["track a token before activating private balances", "Track a token first."],
  [
    "registration requires a network-fee approval",
    "Approve the network fee to finish going private.",
  ],
  [
    "a registration is already on its way for this account",
    "A registration is already on its way for this account.",
  ],
  ["privacy activation preparation failed", "Couldn't prepare activation. Try again."],
  [
    "private pool fee is unavailable. retry the registration.",
    "Couldn't read the pool fee. Try again.",
  ],
  ["shielding preparation failed", "Couldn't prepare shielding. Try again."],
  ["shielding route unavailable", "No shielding route right now. Try again shortly."],
  ["unshielding preparation failed", "Couldn't prepare unshielding. Try again."],
  ["private send preparation failed", "Couldn't prepare this private send. Try again."],
  ["private transaction failed", SUBMISSION_UNKNOWN("The private transaction")],
  [
    "private sends to the sending account are not supported",
    "You can't send privately to the same account.",
  ],
  [
    "the recipient has not activated private balances",
    "That recipient hasn't activated private balances.",
  ],
  ["enter an amount to shield", "Enter an amount to shield."],
  ["enter an amount to unshield", "Enter an amount to unshield."],
  [
    "the previous submission did not reach starknet. try again.",
    "The last submission didn't reach Starknet. Try again.",
  ],
];
