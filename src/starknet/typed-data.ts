/**
 * SNIP-12 typed data validation and hashing for off-chain message signing.
 */
import { typedData as snip12 } from "starknet";
import { WalletError } from "../shared/errors";
import {
  hasOnlyKnownKeys,
  isJsonWithinBudget,
  isRecord,
  JSON_BUDGETS,
  type Json,
} from "../shared/json";
import { isStarkFieldElement } from "./networks";

/**
 * Checks that untrusted input carries the SNIP-12 typed data envelope.
 */
export const isTypedDataShape = (
  value: unknown,
): value is Json & Record<"domain" | "message" | "primaryType" | "types", unknown> =>
  isRecord(value) &&
  isJsonWithinBudget(value, JSON_BUDGETS.typedData) &&
  hasOnlyKnownKeys(value, ["domain", "message", "primaryType", "types"]) &&
  isRecord(value["types"]) &&
  typeof value["primaryType"] === "string" &&
  value["primaryType"].length > 0 &&
  isRecord(value["domain"]) &&
  isRecord(value["message"]);

/**
 * Computes the SNIP-12 message hash an account signs for typed data.
 */
export const typedDataHash = (data: unknown, accountAddress: string): string => {
  if (!isTypedDataShape(data)) {
    throw new WalletError("Invalid typed data");
  }
  let messageHash: string;
  try {
    messageHash = snip12.getMessageHash(
      data as unknown as Parameters<typeof snip12.getMessageHash>[0],
      accountAddress,
    );
  } catch {
    throw new WalletError("Typed data cannot be hashed");
  }
  if (!isStarkFieldElement(messageHash)) {
    throw new WalletError("Typed data produced an invalid hash");
  }
  return messageHash;
};
