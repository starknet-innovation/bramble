/**
 * Contact key stability for the address book (Sherlock 258).
 *
 * A contact's signer key (`publicKeyX`) and coordination key
 * (`nostrPublicKey`) are what the multisig flow trusts when it recognises a
 * co-signer. Saving the same address again may relabel the contact or fill in
 * a key it lacked, but it must not swap a stored key for another one: a
 * wallet card for a known address would otherwise replace them silently,
 * under the label the user already trusts. Replacing a key takes removing the
 * contact and adding it again.
 */

import { sameFelt } from "@bramble/wallet-model/networks";
import type { AddressBookEntry } from "@bramble/wallet-model/preferences";

/** Refusal when a save would replace a stored contact's signer or coordination key. */
export const CONTACT_KEYS_CHANGED = "Contact keys changed";

type ContactKeys = Pick<AddressBookEntry, "nostrPublicKey" | "publicKeyX">;

/**
 * Whether saving `incoming` over `previous` would replace a key `previous`
 * already holds with a different one. A key the incoming entry omits keeps its
 * stored value, and a key `previous` lacks may be added, so neither counts.
 */
export const contactKeysChange = (
  previous: ContactKeys | undefined,
  incoming: ContactKeys,
): boolean =>
  (previous?.publicKeyX !== undefined &&
    incoming.publicKeyX !== undefined &&
    !sameFelt(previous.publicKeyX, incoming.publicKeyX)) ||
  (previous?.nostrPublicKey !== undefined &&
    incoming.nostrPublicKey !== undefined &&
    previous.nostrPublicKey.toLowerCase() !== incoming.nostrPublicKey.toLowerCase());
