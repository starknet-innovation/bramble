/**
 * Reads the recipient rows the Send recipient screen rendered: the user's own
 * accounts, saved contacts, and shared accounts, all on the active network. The
 * lookup lives here so the name shown, the "Save address" offer and the
 * review's new-recipient warning can never disagree about which row an address
 * belongs to, and so the rule that decides whether typed text names a row is
 * the same rule the list itself filters by.
 */
import { sameFelt } from "@bramble/wallet-model/networks";

/**
 * The name of the row a typed address belongs to, or `undefined` when no row
 * lists it. Compared as felts, so a padded or differently cased spelling of a
 * known address is still known. Names only ever come from the rendered rows,
 * never from the typed text.
 */
export const knownRecipientLabel = (form: HTMLFormElement, address: string): string | undefined =>
  [...form.querySelectorAll<HTMLElement>("[data-send-recipient]")].find((row) =>
    sameFelt(row.dataset["sendRecipient"] ?? "", address),
  )?.dataset["sendRecipientLabel"];

/**
 * True when the typed address matches no row on the screen. The same lookup as
 * the name, so "Save address" and the name shown can never disagree.
 */
export const isUnlistedRecipient = (form: HTMLFormElement, address: string): boolean =>
  knownRecipientLabel(form, address) === undefined;

/**
 * The listed recipients the typed text matches, by the rule the recipient list
 * filters with: an exact label wins, otherwise a row whose search text contains
 * the query. The recipient step never resolves a name while the text matches a
 * listed contact or account, so this decides which row a typed text names (or
 * that several do) before any network read starts.
 */
export const matchingRecipients = (form: HTMLFormElement, text: string): HTMLElement[] => {
  const query = text.trim().toLowerCase();
  if (query.length === 0) {
    return [];
  }
  const rows = [...form.querySelectorAll<HTMLElement>("[data-send-recipient]")];
  const exact = rows.filter(
    (row) => (row.dataset["sendRecipientLabel"] ?? "").trim().toLowerCase() === query,
  );
  return exact.length > 0
    ? exact
    : rows.filter((row) => (row.dataset["sendSearch"] ?? "").includes(query));
};
