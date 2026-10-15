/**
 * Test helper: a current (v12) vault fixture restamped as an older version.
 */

// A v12 record stamped with an older version: the scope records are what v12
// added, so a legacy stamp drops them before the older validator judges it.
export const withoutScopes = <T extends { readonly shadowAccountScopes?: unknown }>(
  vault: T,
): Omit<T, "shadowAccountScopes"> => {
  const { shadowAccountScopes: _scopes, ...rest } = vault;
  return rest;
};

/** The same fixture as a v7 record, which predates imported seeds too. */
export const asV7 = <
  T extends { readonly importedSeeds?: unknown; readonly shadowAccountScopes?: unknown },
>(
  vault: T,
): Omit<T, "importedSeeds" | "shadowAccountScopes"> & { readonly schemaVersion: 7 } => {
  const { importedSeeds: _seeds, shadowAccountScopes: _scopes, ...rest } = vault;
  return { ...rest, schemaVersion: 7 };
};
