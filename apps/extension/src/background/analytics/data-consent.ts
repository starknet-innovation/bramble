/**
 * The browser's own answer to "may this extension send technical data".
 *
 * Firefox asks at install time, driven by the `data_collection_permissions`
 * this build declares in its manifest, and records the user's choice as a
 * permission. Declaring `technicalAndInteraction` as OPTIONAL is a promise that
 * unticking that box turns the collection off — a promise the wallet's own
 * preference cannot keep on its own, because that preference defaults to on and
 * knows nothing about the install dialog. This module is what makes the
 * declaration true.
 *
 * Chromium has no equivalent concept. There the wallet's settings toggle is the
 * only control, and this module reports "allowed" so nothing changes.
 */

/** The data-collection permission Firefox records for technical and interaction data. */
export const TECHNICAL_DATA_COLLECTION = "technicalAndInteraction";

/**
 * The slice of `permissions` this module uses. Every member is optional so the
 * same shape covers a browser that implements none of it, and so tests can pass
 * a double.
 */
export type DataConsentPermissions = {
  readonly contains?: (permissions: {
    readonly data_collection: readonly string[];
  }) => Promise<boolean>;
  readonly onAdded?: { readonly addListener: (listener: () => void) => void };
  readonly onRemoved?: { readonly addListener: (listener: () => void) => void };
};

/**
 * Whether the browser's consent allows technical and interaction data.
 *
 * Resolves to `true` on a runtime that does not implement data-collection
 * permissions at all, which is every Chromium build: there is no consent to
 * honour, and refusing would silently disable analytics the user did choose.
 *
 * A runtime that DOES implement it and then fails the query resolves to
 * `false`. Consent that cannot be confirmed is not consent, and the cost of
 * being wrong in that direction is only a gap in metrics.
 */
export const technicalDataAllowed = async (
  permissions: DataConsentPermissions | undefined,
): Promise<boolean> => {
  const contains = permissions?.contains;
  if (!contains) {
    return true;
  }
  try {
    return await contains({ data_collection: [TECHNICAL_DATA_COLLECTION] });
  } catch {
    return false;
  }
};

/**
 * Calls `onChange` whenever the browser's data-collection consent may have
 * moved, so a user who revokes it later is honoured without restarting the
 * extension. Registers nothing on a runtime without the events; the listeners
 * are added synchronously so a terminated event page re-registers them on
 * revival.
 */
export const observeTechnicalDataConsent = (
  permissions: DataConsentPermissions | undefined,
  onChange: () => void,
): void => {
  permissions?.onAdded?.addListener(onChange);
  permissions?.onRemoved?.addListener(onChange);
};
