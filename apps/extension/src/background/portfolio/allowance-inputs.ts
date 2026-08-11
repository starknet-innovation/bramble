/**
 * Pure parsers for allowance-manager runtime messages from extension pages.
 */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";

// Allowance ids compose `<networkId>:<address>:<token>:<spender>`; with
// full-length felts they run to ~208 characters, so the cap must sit
// comfortably above.
const MAX_ID_LENGTH = 240;

/**
 * Parses a revoke request that targets a tracked allowance by its id.
 */
export const readRevokeAllowanceInput = (message: unknown): { readonly id: string } | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["id", "type"]) &&
  message["type"] === "wallet.revokeAllowance" &&
  typeof message["id"] === "string" &&
  message["id"].length > 0 &&
  message["id"].length <= MAX_ID_LENGTH
    ? { id: message["id"] }
    : null;
