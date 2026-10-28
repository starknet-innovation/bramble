/**
 * Reader-facing sentences for import by address (issues 398 and 779),
 * consumed by the main table in ./friendly-error-copy. Split from it by the
 * size budget; same contract — exact lowercase diagnostic to sentence.
 */
import {
  ADDRESS_IMPORT_REFUSALS,
  KEY_ADDRESS_IMPORT_REFUSALS,
} from "@bramble/wallet-model/recovery";

/** Import-by-address entries merged into ERROR_COPY, in table order. */
export const ADDRESS_IMPORT_ERROR_COPY: readonly (readonly [string, string])[] = [
  // Finding an account by its pasted address (issue 398). The panel names the
  // network in the not-found sentence itself; this is the fallback wording.
  [ADDRESS_IMPORT_REFUSALS.invalid, "That doesn't look like a Starknet address."],
  [
    ADDRESS_IMPORT_REFUSALS.notDeployed,
    "No account found at this address on this network. Check the address and network.",
  ],
  [
    ADDRESS_IMPORT_REFUSALS.unsupportedClass,
    "Bramble doesn't support this account's contract version yet.",
  ],
  [
    ADDRESS_IMPORT_REFUSALS.brambleAccount,
    "This is a Bramble account. Use Find my accounts instead.",
  ],
  [
    ADDRESS_IMPORT_REFUSALS.nonStarkOwner,
    "This account is controlled by a signer Bramble can't use.",
  ],
  [ADDRESS_IMPORT_REFUSALS.noMatch, "This recovery phrase doesn't control that account."],
  [ADDRESS_IMPORT_REFUSALS.unavailable, "Couldn't check this account. Try again."],
  [ADDRESS_IMPORT_REFUSALS.unconfirmed, "Couldn't confirm this account. Try again."],
  [
    ADDRESS_IMPORT_REFUSALS.stale,
    "This wallet changed while the account was being checked. Search for it again.",
  ],
  // The private-key variant (issue 779) names the key, and sends a Bramble
  // account to the account type that imports it.
  [KEY_ADDRESS_IMPORT_REFUSALS.noMatch, "This private key doesn't control that account."],
  [
    KEY_ADDRESS_IMPORT_REFUSALS.brambleAccount,
    "This is a Bramble account. Choose Bramble Account to import it.",
  ],
];
