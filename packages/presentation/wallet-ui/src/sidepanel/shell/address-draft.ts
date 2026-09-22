/**
 * One-shot handoff of a recipient address from Send to the address book form.
 *
 * Send knows the address the user typed; the address book screen is rendered
 * from preferences and has no way to learn it. This carries exactly that one
 * public value across the navigation, and is consumed on read so returning to
 * the screen later starts from an empty form. Panel-local and never persisted.
 */

let draftAddress = "";

/** Records the address the address book form should open with. */
export const setAddressBookDraft = (address: string): void => {
  draftAddress = address;
};

/** Reads and clears the pending address, returning "" when there is none. */
export const takeAddressBookDraft = (): string => {
  const address = draftAddress;
  draftAddress = "";
  return address;
};
