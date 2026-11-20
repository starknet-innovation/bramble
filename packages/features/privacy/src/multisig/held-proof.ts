/**
 * A multisig's compiled proof request, kept while co-owners sign its pool
 * authorization. Only the envelope is stored: the block, nonce, and resource
 * bounds the SDK chose. The calldata is rebuilt from the authorization's own
 * calls when the request is proved, so the proved request is always the one
 * the stored digest covers, and the shared scalar is never written here.
 */
import { hasOnlyKnownKeys, isRecord, type Json } from "@bramble/core/json";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { hash, num } from "starknet";
import type { MultisigStrk20RedactedCall } from "./records";

const MAX_ENVELOPE_CHARACTERS = 8_192;
const MAX_PLAN_CHARACTERS = 16_384;
// Fields the envelope never holds: rebuilt from the signed calls, or replaced
// by the co-owners' aggregate.
const REBUILT_FIELDS = ["calldata", "signature"] as const;

/** One held request. `id` is the authorization id it is signed under. */
export type MultisigStrk20HeldProof = {
  readonly accountId: string;
  readonly envelope: { readonly [key: string]: Json };
  readonly id: string;
  /** Relay only: the fee plan whose fee action the compiled actions include. */
  readonly plan?: { readonly [key: string]: Json };
  readonly provingBlock: number;
};

const jsonRecord = (value: unknown, limit: number): { readonly [key: string]: Json } | null => {
  if (!isRecord(value)) return null;
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (text === undefined || text.length > limit) return null;
  const copy: unknown = JSON.parse(text);
  return isRecord(copy) ? (copy as { readonly [key: string]: Json }) : null;
};

/**
 * The parts of a compiled invocation that are kept, or null when it is not a
 * plain JSON object of bounded size.
 */
export const multisigStrk20HeldEnvelope = (
  invocation: Readonly<Record<string, unknown>>,
): { readonly [key: string]: Json } | null => {
  const kept = Object.fromEntries(
    Object.entries(invocation).filter(
      ([key]) => !(REBUILT_FIELDS as readonly string[]).includes(key),
    ),
  );
  return jsonRecord(kept, MAX_ENVELOPE_CHARACTERS);
};

/** Bounds a relay fee plan for storage, or null when it cannot be kept. */
export const multisigStrk20HeldPlan = (plan: unknown): { readonly [key: string]: Json } | null =>
  jsonRecord(plan, MAX_PLAN_CHARACTERS);

/**
 * Validates a stored row. The envelope must not carry calldata or a
 * signature, and the id must name an authorization of the same multisig.
 */
export const isMultisigStrk20HeldProof = (value: unknown): value is MultisigStrk20HeldProof =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["accountId", "envelope", "id", "plan", "provingBlock"]) &&
  typeof value["accountId"] === "string" &&
  value["accountId"].length > 0 &&
  typeof value["id"] === "string" &&
  value["id"].length <= 256 &&
  value["id"].startsWith(`${value["accountId"]}:`) &&
  jsonRecord(value["envelope"], MAX_ENVELOPE_CHARACTERS) !== null &&
  REBUILT_FIELDS.every((field) => !Object.hasOwn(value["envelope"] as object, field)) &&
  (value["plan"] === undefined || jsonRecord(value["plan"], MAX_PLAN_CHARACTERS) !== null) &&
  Number.isSafeInteger(value["provingBlock"]) &&
  (value["provingBlock"] as number) >= 0;

/**
 * The `__execute__` calldata the SDK proves for one pool call: one call, its
 * target, selector, and length-prefixed calldata, as canonical felts. Null
 * when a felt is not canonical.
 */
export const multisigStrk20ExecuteCalldata = (
  call: MultisigStrk20RedactedCall,
): readonly string[] | null => {
  const felts = [
    "0x1",
    call.contractAddress,
    hash.getSelectorFromName(call.entrypoint),
    num.toHex(call.calldata.length),
    ...call.calldata,
  ].map((felt) => canonicalFelt(String(felt)));
  return felts.every((felt): felt is string => felt !== null) ? felts : null;
};

/** True when two felt lists are equal felt by felt. */
export const sameMultisigStrk20Felts = (
  left: readonly unknown[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((felt, index) => canonicalFelt(String(felt)) === right[index]);
