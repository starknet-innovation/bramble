/**
 * The felt the user compares against their phone, rendered the one way both
 * paired-phone screens render it.
 *
 * Shared because the comparison only works when the two screens agree
 * character for character, and they did not: the signing takeover padded the
 * transaction hash to its full 64 digits and grouped it, while the enrollment
 * takeover printed the challenge exactly as the wallet spelled it. The phone
 * pads both to 32 big-endian bytes before signing and displays what it signed,
 * so any challenge with a leading zero read as a mismatch on a screen whose
 * whole job is telling the user they match.
 *
 * Presentational only. The value carried, copied and signed stays unbroken —
 * the groups are spans the stylesheet spaces, never characters in the felt.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import { paddedFelt } from "@mc-wallet/wallet-model/networks";

// Hex digits per rendered group, matching the Ledger takeover: 64 digits are far
// easier to track in short groups than as one unbroken run.
const HASH_GROUP_SIZE = 4;

const hexGroups = (digits: string): readonly string[] => {
  const groups: string[] = [];
  for (let index = 0; index < digits.length; index += HASH_GROUP_SIZE) {
    groups.push(digits.slice(index, index + HASH_GROUP_SIZE));
  }
  return groups;
};

/**
 * Renders one compare-this-against-your-phone card: a label, the felt at full
 * padded width in groups of four, and the help line that says what to do with
 * it.
 *
 * A value that is not a field element is rendered as it arrived rather than
 * padded — `paddedFelt` refuses it, and inventing digits for a malformed value
 * would show the user a number nothing signed. Never given a copy control: these
 * values exist to be read side by side, and a copy button beside one is an
 * invitation to move the wrong thing.
 */
export const feltCheckBlock = (input: {
  readonly help: string;
  readonly label: string;
  readonly value: string;
}): string => {
  const felt = paddedFelt(input.value) ?? input.value;
  const digits = felt.startsWith("0x") ? felt.slice(2) : felt;
  return `<section class="ledger-hash-check">
    <div class="ledger-hash-head">
      <p class="context-label">${escapeHtml(input.label)}</p>
    </div>
    <p class="ledger-hash-value"><code>${escapeHtml("0x")}${hexGroups(digits)
      .map((group) => `<span>${escapeHtml(group)}</span>`)
      .join("")}</code></p>
    <p class="ledger-hash-help">${escapeHtml(input.help)}</p>
  </section>`;
};
