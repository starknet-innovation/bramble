/**
 * The pool storage slots a relayed `apply_actions` call writes once, recorded
 * on its `submitting` claim so the chain can later prove the call can no
 * longer apply (mc-wallet #668).
 *
 * The pool's `WriteOnce` action asserts every slot it writes is still zero, so
 * an `apply_actions` call one of whose `WriteOnce` slots is already non-zero
 * reverts as a whole. That holds whoever relays the call and whatever else its
 * actions say, which is why the slots are read from the exact calldata handed
 * to the relay rather than from any event field. Every proof the pool accepts
 * carries at least one `WriteOnce` (its replay protection), so a call with
 * none is malformed here.
 */

import { canonicalFelt, isNonZeroStarkFieldElement } from "@bramble/wallet-model/networks";
import { CairoCustomEnum, CallData } from "starknet";
import { POOL_SERVER_ACTIONS_ABI } from "./pool-server-actions-abi";

/** Most slots a relay claim keeps; a call writing more is refused before it is sent. */
export const MAX_RELAY_CLAIM_SLOTS = 64;

const SERVER_ACTIONS = "core::array::Span::<privacy::actions::ServerAction>";

// starknet.js decodes a Span as the struct the ABI declares it as.
const decodedActions = (decoded: unknown): readonly unknown[] | null => {
  if (Array.isArray(decoded)) return decoded;
  if (typeof decoded === "object" && decoded !== null && "snapshot" in decoded) {
    const snapshot = (decoded as { readonly snapshot: unknown }).snapshot;
    return Array.isArray(snapshot) ? snapshot : null;
  }
  return null;
};

const slotOf = (input: unknown): string | null => {
  if (typeof input !== "object" || input === null || !("storage_address" in input)) return null;
  const address = (input as { readonly storage_address: unknown }).storage_address;
  if (typeof address !== "bigint" || address < 0n) return null;
  const slot = canonicalFelt(`0x${address.toString(16)}`);
  return slot && isNonZeroStarkFieldElement(slot) ? slot : null;
};

/**
 * The distinct `WriteOnce` base slots of an `apply_actions` call, sorted, as
 * canonical felts. Trust boundary: `calldata` is the prover's output and is
 * untrusted, but a slot taken from it can only make the release rule stricter,
 * because the pool enforces `WriteOnce` on exactly these addresses. Failure
 * behaviour: returns null when the calldata does not decode as a
 * `Span<ServerAction>`, holds no `WriteOnce`, or holds more than
 * {@link MAX_RELAY_CLAIM_SLOTS} slots; the caller must then refuse to send.
 * Trailing calldata after the span (the screening attestation) is ignored.
 */
export const relayClaimSlots = (calldata: readonly string[]): readonly string[] | null => {
  let actions: readonly unknown[] | null;
  try {
    actions = decodedActions(
      new CallData(POOL_SERVER_ACTIONS_ABI).decodeParameters(SERVER_ACTIONS, [...calldata]),
    );
  } catch {
    return null;
  }
  if (!actions) return null;
  const slots = new Set<string>();
  for (const action of actions) {
    if (!(action instanceof CairoCustomEnum)) return null;
    if (action.activeVariant() !== "WriteOnce") continue;
    const slot = slotOf(action.unwrap());
    if (!slot) return null;
    slots.add(slot);
  }
  const sorted = [...slots].sort();
  return sorted.length > 0 && sorted.length <= MAX_RELAY_CLAIM_SLOTS ? sorted : null;
};
