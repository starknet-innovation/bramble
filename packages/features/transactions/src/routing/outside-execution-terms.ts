/**
 * Reads the terms of a SNIP-9 `OutsideExecution` message the user signed: the
 * nonce the account spends when a relayer executes it, the caller it is bound
 * to, its execution window and how many calls it carries. Activity uses them to
 * record a message signed for relay and later ask the account whether that nonce was
 * used (issue 299).
 *
 * Trust boundary: the typed data is untrusted dapp input. Every field is read
 * through the pinned SNIP-12 encoder with the canonical OutsideExecution field
 * types, as `outsideExecutionCalls` reads the calls, so the nonce recorded is the
 * felt the account itself would check. A message that is not a complete,
 * well-formed OutsideExecution for the account's outside-execution domain gives
 * `null`, and nothing is recorded for it.
 */

import { isRecord } from "@bramble/core/json";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { typedData as snip12, TypedDataRevision } from "starknet";
import { outsideExecutionCalls } from "./outside-execution-calls";

/**
 * The SNIP-9 domain name both revisions sign under. A message under any other
 * domain hashes differently from what the account checks, so its nonce says
 * nothing about it.
 */
export const OUTSIDE_EXECUTION_DOMAIN = "Account.execute_from_outside";

/** The terms one signed OutsideExecution commits to. */
export type OutsideExecutionTerms = {
  readonly callCount: number;
  /** Canonical felt; `ANY_CALLER` is the shortstring felt for "any relayer". */
  readonly caller: string;
  /** Unix seconds; `null` when the bound is too large to be a real deadline. */
  readonly executeBefore: number | null;
  /** Canonical felt the account marks used when the execution runs. */
  readonly nonce: string;
  readonly revision: "1" | "2";
};

type TermFields = {
  readonly caller: readonly [string, string];
  readonly executeBefore: readonly [string, string];
  readonly nonce: readonly [string, string];
  readonly revision: TypedDataRevision;
};

// Field name and canonical SNIP-12 type for each term, per message layout.
const V1: TermFields = {
  caller: ["caller", "felt"],
  executeBefore: ["execute_before", "felt"],
  nonce: ["nonce", "felt"],
  revision: TypedDataRevision.LEGACY,
};
const V2: TermFields = {
  caller: ["Caller", "ContractAddress"],
  executeBefore: ["Execute Before", "u128"],
  nonce: ["Nonce", "felt"],
  revision: TypedDataRevision.ACTIVE,
};

const encode = (
  message: Record<string, unknown>,
  [name, type]: readonly [string, string],
  revision: TypedDataRevision,
): string | null => {
  if (!(name in message)) {
    return null;
  }
  try {
    return canonicalFelt(snip12.encodeValue({}, type, message[name], undefined, revision)[1]);
  } catch {
    return null;
  }
};

const seconds = (felt: string): number | null => {
  const value = BigInt(felt);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

/**
 * Returns the terms of a well-formed OutsideExecution under the SNIP-9 domain,
 * or `null` for any other message, a malformed one, or one whose calls cannot
 * be read exactly.
 */
export const outsideExecutionTerms = (typedData: unknown): OutsideExecutionTerms | null => {
  const calls = outsideExecutionCalls(typedData);
  if (calls === null || calls === "malformed" || !isRecord(typedData)) {
    return null;
  }
  const domain = typedData["domain"];
  const message = typedData["message"];
  if (!isRecord(domain) || domain["name"] !== OUTSIDE_EXECUTION_DOMAIN || !isRecord(message)) {
    return null;
  }
  // The layout was already settled by outsideExecutionCalls: exactly one of
  // `calls` (v1) and `Calls` (v2) is an array.
  const fields = Array.isArray(message["calls"]) ? V1 : V2;
  const nonce = encode(message, fields.nonce, fields.revision);
  const caller = encode(message, fields.caller, fields.revision);
  const before = encode(message, fields.executeBefore, fields.revision);
  if (nonce === null || caller === null || before === null) {
    return null;
  }
  return {
    callCount: calls.length,
    caller,
    executeBefore: seconds(before),
    nonce,
    revision: fields === V1 ? "1" : "2",
  };
};
