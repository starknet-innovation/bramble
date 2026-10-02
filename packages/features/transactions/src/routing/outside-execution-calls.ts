/**
 * Reads the calls a SNIP-9 `OutsideExecution` typed-data message authorizes, so
 * the sign route can run the same call review (`verifyCalls`, the self-call and
 * poisoned-recipient refusals) the invoke route applies.
 *
 * Trust boundary: the typed data is untrusted dapp input. Every felt is read
 * through the pinned SNIP-12 value encoder with the canonical OutsideExecution
 * field types, so the address, selector and calldata reviewed here are the
 * exact felts the signed hash commits to (a decimal, a shortstring, or a v2
 * selector NAME all resolve the way the hasher resolves them). The version is
 * keyed on the message shape (`calls` vs `Calls`), not on `domain.version`: a
 * shortstring "0x32" hashes like "2", so a string check would let an envelope
 * the account still executes skip review. Any OutsideExecution the reader
 * cannot parse is reported as `"malformed"` and must be refused, never signed
 * unchecked.
 */

import { isRecord } from "@bramble/core/json";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { type Call, hash, typedData as snip12, TypedDataRevision } from "starknet";
import { isSnip9RelayDetail, type Snip9RelayDetail } from "../activity/relay-detail";
import { DECODED_ENTRYPOINTS } from "./verify-decode";

type CallShape = {
  readonly calldata: string;
  readonly caller: string;
  readonly callerType: string;
  readonly calls: string;
  readonly nonce: string;
  readonly revision: TypedDataRevision;
  readonly selector: string;
  readonly selectorType: string;
  readonly to: string;
  readonly toType: string;
  readonly version: "1" | "2";
};

// The two SNIP-9 message layouts starknet.js and the account contracts use.
const V1: CallShape = {
  calldata: "calldata",
  caller: "caller",
  callerType: "felt",
  calls: "calls",
  nonce: "nonce",
  revision: TypedDataRevision.LEGACY,
  selector: "selector",
  selectorType: "felt",
  to: "to",
  toType: "felt",
  version: "1",
};
const V2: CallShape = {
  calldata: "Calldata",
  caller: "Caller",
  callerType: "ContractAddress",
  calls: "Calls",
  nonce: "Nonce",
  revision: TypedDataRevision.ACTIVE,
  selector: "Selector",
  selectorType: "selector",
  to: "To",
  toType: "ContractAddress",
  version: "2",
};

// Selector hash -> entrypoint name, built once from the decoder's own
// vocabulary. A selector not in it keeps its hex spelling and decodes as an
// opaque call, so a gap here under-describes a call and never invents one.
const ENTRYPOINT_BY_SELECTOR: ReadonlyMap<string, string> = new Map(
  DECODED_ENTRYPOINTS.map((name) => [canonicalFelt(hash.getSelectorFromName(name)) ?? name, name]),
);

const encodeFelt = (type: string, value: unknown, revision: TypedDataRevision): string | null => {
  try {
    return canonicalFelt(snip12.encodeValue({}, type, value, undefined, revision)[1]);
  } catch {
    return null;
  }
};

const readCall = (value: unknown, shape: CallShape): Call | null => {
  if (!isRecord(value) || !Array.isArray(value[shape.calldata])) {
    return null;
  }
  const to = encodeFelt(shape.toType, value[shape.to], shape.revision);
  const selector = encodeFelt(shape.selectorType, value[shape.selector], shape.revision);
  const calldata = (value[shape.calldata] as readonly unknown[]).map((felt) =>
    encodeFelt("felt", felt, shape.revision),
  );
  if (to === null || selector === null || calldata.some((felt) => felt === null)) {
    return null;
  }
  return {
    calldata: calldata as string[],
    contractAddress: to,
    entrypoint: ENTRYPOINT_BY_SELECTOR.get(selector) ?? selector,
  };
};

/**
 * Returns the calls an `OutsideExecution` message authorizes, with each
 * selector mapped back to the entrypoint name the call reviewer understands;
 * `null` when the typed data is not an OutsideExecution (plain SNIP-12
 * messages are untouched); `"malformed"` when it is one but its calls cannot
 * be read exactly. Callers must refuse `"malformed"`.
 */
export const outsideExecutionCalls = (typedData: unknown): readonly Call[] | null | "malformed" => {
  if (!isRecord(typedData) || typedData["primaryType"] !== "OutsideExecution") {
    return null;
  }
  const message = typedData["message"];
  if (!isRecord(message)) {
    return "malformed";
  }
  const v1 = Array.isArray(message[V1.calls]);
  const v2 = Array.isArray(message[V2.calls]);
  if (v1 === v2) {
    return "malformed";
  }
  const shape = v1 ? V1 : V2;
  const calls = (message[shape.calls] as readonly unknown[]).map((call) => readCall(call, shape));
  return calls.every((call): call is Call => call !== null) ? calls : "malformed";
};

/**
 * Reads the SNIP-9 detail the activity feed keeps for a signed
 * `OutsideExecution`: the revision, the nonce and caller the signed message
 * commits to, the number of calls, and the canonical message hash the signer
 * computed. `null` when the typed data is not an OutsideExecution;
 * `"malformed"` when it is one but any field cannot be read through the pinned
 * SNIP-12 encoder, so a caller records only what it can prove the message
 * covered.
 *
 * Trust boundary: `typedData` is untrusted dapp input and `messageHash` is the
 * exact hash the signer computed, never a value from the payload. Every felt is
 * re-encoded with the canonical field types and the stored detail is validated
 * once more, so a row written from a malformed envelope is impossible.
 */
export const outsideExecutionDetails = (
  typedData: unknown,
  messageHash: string,
): Snip9RelayDetail | null | "malformed" => {
  if (!isRecord(typedData) || typedData["primaryType"] !== "OutsideExecution") {
    return null;
  }
  const message = typedData["message"];
  if (!isRecord(message)) {
    return "malformed";
  }
  const v1 = Array.isArray(message[V1.calls]);
  const v2 = Array.isArray(message[V2.calls]);
  if (v1 === v2) {
    return "malformed";
  }
  const shape = v1 ? V1 : V2;
  const calls = (message[shape.calls] as readonly unknown[]).map((call) => readCall(call, shape));
  if (calls.some((call) => call === null)) {
    return "malformed";
  }
  const nonce = encodeFelt("felt", message[shape.nonce], shape.revision);
  const caller = encodeFelt(shape.callerType, message[shape.caller], shape.revision);
  const hash = typeof messageHash === "string" ? canonicalFelt(messageHash) : null;
  if (nonce === null || caller === null || hash === null) {
    return "malformed";
  }
  const detail: Snip9RelayDetail = {
    callCount: calls.length,
    caller,
    messageHash: hash,
    nonce,
    revision: shape.version,
  };
  return isSnip9RelayDetail(detail) ? detail : "malformed";
};
