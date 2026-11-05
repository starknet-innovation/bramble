/**
 * Test helper: a current (v13) vault fixture restamped as an older version.
 */

type LaterCollections = {
  readonly qsbAccounts?: unknown;
  readonly shadowAccountScopes?: unknown;
};

// A current record stamped with a version before v12: the scope records (v12)
// and QSB accounts (v13) are what later versions added, so a legacy stamp
// drops both before the older validator judges it.
export const withoutScopes = <T extends LaterCollections>(
  vault: T,
): Omit<T, "qsbAccounts" | "shadowAccountScopes"> => {
  const { qsbAccounts: _qsb, shadowAccountScopes: _scopes, ...rest } = vault;
  return rest;
};

/** The same fixture as a v7 record, which predates imported seeds too. */
export const asV7 = <T extends LaterCollections & { readonly importedSeeds?: unknown }>(
  vault: T,
): Omit<T, "importedSeeds" | "qsbAccounts" | "shadowAccountScopes"> & {
  readonly schemaVersion: 7;
} => {
  const { importedSeeds: _seeds, qsbAccounts: _qsb, shadowAccountScopes: _scopes, ...rest } = vault;
  return { ...rest, schemaVersion: 7 };
};
