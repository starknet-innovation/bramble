/**
 * Handoff of a recipient from Send into the address book form.
 *
 * Send knows the address the user typed; the address book screen is rendered
 * from preferences and has no way to learn it. The handoff stays until the
 * entry is saved or the user leaves the screen: a shell repaint rebuilds the
 * form from an empty template, and reading the handoff once would drop the
 * address and anything typed beside it. Panel-local, public, and never persisted.
 */

let draftAddress = "";
let draftLabel = "";
let focusLabelOnBind = false;

/**
 * Records the address the address book form should open with.
 *
 * Replaces any label typed for a previous handoff. The value stays in this
 * module only — nothing is written to storage, and a later bind reads it
 * again until {@link clearAddressBookDraft}.
 */
export const setAddressBookDraft = (address: string): void => {
  draftAddress = address;
  draftLabel = "";
  focusLabelOnBind = true;
};

/**
 * Remembers the address and label currently typed, so the next bind can put
 * them back into a rebuilt form.
 *
 * Empty strings are kept: clearing a field is a choice the next paint must
 * not undo. Does not persist anything.
 */
export const rememberAddressBookDraft = (address: string, label: string): void => {
  draftAddress = address;
  draftLabel = label;
};

/**
 * Drops the handoff so the next address book form opens empty.
 *
 * Called after a successful save and when the screen no longer shows the form.
 * A failed save keeps the handoff, so the user can correct it and retry.
 */
export const clearAddressBookDraft = (): void => {
  draftAddress = "";
  draftLabel = "";
  focusLabelOnBind = false;
};

/**
 * The address and label waiting to be shown, or empty strings when nothing
 * is pending. Does not consume the handoff.
 */
export const addressBookDraft = (): { readonly address: string; readonly label: string } => ({
  address: draftAddress,
  label: draftLabel,
});

/**
 * Whether this bind should focus the label.
 *
 * True only for the first bind after {@link setAddressBookDraft}, so a later
 * repaint does not pull the caret off a field the user has moved to. Reading
 * it consumes that one-shot.
 */
export const takeAddressBookLabelFocus = (): boolean => {
  const focus = focusLabelOnBind;
  focusLabelOnBind = false;
  return focus;
};
