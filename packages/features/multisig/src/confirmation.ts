/**
 * Exact operation authorized from a multisig confirmation review.
 */
export type MultisigConfirmationMode = "confirm-and-execute" | "confirm-only";

/**
 * Parses an untrusted confirmation mode into the closed internal union.
 */
export const isMultisigConfirmationMode = (value: unknown): value is MultisigConfirmationMode =>
  value === "confirm-and-execute" || value === "confirm-only";
