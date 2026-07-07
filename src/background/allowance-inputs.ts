/**
 * Pure parsers for allowance-manager runtime messages from extension pages.
 */
import { hasOnlyKnownKeys, isRecord } from "../shared/json";

/**
 * Parses a revoke request that targets a tracked allowance by its id.
 */
export const readRevokeAllowanceInput = (message: unknown): { readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "type"]) &&
  message.type === "wallet.revokeAllowance" &&
  typeof message.id === "string" &&
  message.id.length > 0 &&
  message.id.length <= 200
    ? { id: message.id }
    : null;
