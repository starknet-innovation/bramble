/** Explicit account origins, retained inside backups; absence never implies creation. */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";

/** Account lifecycle provenance, independent of signing or derivation scheme. */
export type AccountProvenance = "created" | "imported";

/** Checks origin labels against the accounts actually held in this vault. */
export const validAccountProvenance = (
  value: unknown,
  accounts: readonly { readonly id: string }[],
): boolean =>
  value === undefined ||
  (isRecord(value) &&
    hasOnlyKnownKeys(
      value,
      accounts.map((account) => account.id),
    ) &&
    Object.values(value).every((origin) => origin === "created" || origin === "imported"));
