/**
 * The WriteOnce slots a relay claim records are read from the exact
 * `apply_actions` calldata (#668). Variant indices follow the pool's
 * `ServerAction` enum: 0 WriteOnce, 9 EmitNoteUsed, 10 Invoke.
 */

import { describe, expect, test } from "bun:test";
import { MAX_RELAY_CLAIM_SLOTS, relayClaimSlots } from "@bramble/privacy/relay-claim-slots";

const writeOnce = (slot: string, ...value: string[]): string[] => [
  "0x0",
  slot,
  `0x${value.length.toString(16)}`,
  ...value,
];
const noteUsed = (nullifier: string): string[] => ["0x9", nullifier];
const span = (...actions: string[][]): string[] => [
  `0x${actions.length.toString(16)}`,
  ...actions.flat(),
];

describe("relay claim slots", () => {
  test("returns every WriteOnce slot, sorted and distinct, ignoring other actions", () => {
    expect(
      relayClaimSlots(
        span(
          writeOnce("0xabd", "0x1"),
          noteUsed("0xdef"),
          writeOnce("0xabc", "0x1", "0x2"),
          writeOnce("0xABD", "0x1"),
        ),
      ),
    ).toEqual(["0xabc", "0xabd"]);
  });

  test("ignores the trailing screening attestation after the span", () => {
    expect(relayClaimSlots([...span(writeOnce("0x5157", "0x1")), "0x1"])).toEqual(["0x5157"]);
    expect(relayClaimSlots([...span(writeOnce("0x5157", "0x1")), "0x0", "0x7", "0x8"])).toEqual([
      "0x5157",
    ]);
  });

  test("refuses calldata that carries no WriteOnce, since nothing could prove it dead", () => {
    expect(relayClaimSlots(span(noteUsed("0xdef")))).toBeNull();
    expect(relayClaimSlots(span())).toBeNull();
  });

  test("refuses calldata that does not decode as a ServerAction span", () => {
    expect(relayClaimSlots([])).toBeNull();
    expect(relayClaimSlots(["0x2", "0x0", "0xabc"])).toBeNull();
    expect(relayClaimSlots(["0x1", "0x63", "0x1"])).toBeNull();
    expect(relayClaimSlots(["not-a-felt"])).toBeNull();
  });

  test("refuses a zero slot, which no WriteOnce could target", () => {
    expect(relayClaimSlots(span(writeOnce("0x0", "0x1")))).toBeNull();
  });

  test("refuses more slots than a claim keeps", () => {
    const many = Array.from({ length: MAX_RELAY_CLAIM_SLOTS + 1 }, (_, index) =>
      writeOnce(`0x${(index + 1).toString(16)}`, "0x1"),
    );
    expect(relayClaimSlots(span(...many))).toBeNull();
    expect(relayClaimSlots(span(...many.slice(0, MAX_RELAY_CLAIM_SLOTS)))).toHaveLength(
      MAX_RELAY_CLAIM_SLOTS,
    );
  });
});
