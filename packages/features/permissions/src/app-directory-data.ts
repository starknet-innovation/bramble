/**
 * The bundled app directory entries (mc-wallet issue 749). SNF lists an app by
 * hand once it meets the published admission standard
 * (docs/APP_DIRECTORY.md); an entry is added only by a reviewed PR, and the
 * test suite rejects any entry that breaks the schema in ./app-directory.
 *
 * Empty until the first app is admitted. While a network has no listed app,
 * the directory screen and its menu row stay hidden, and no approval card
 * shows a listing.
 */
import type { ListedApp } from "./app-directory-types";

/** Listed apps. Exact https origins; contracts as canonical felts. */
export const LISTED_APPS: readonly ListedApp[] = [];

/**
 * Exact origins removed from the directory. A delisted app is warned about on
 * its next connection or signing request instead of being forgotten; the
 * user's existing grant is left for the user to revoke.
 */
export const REVOKED_APPS: readonly string[] = [];
