/**
 * Intent capacity (Sherlock 179): one multisig's proposals, such as a flood a
 * co-signer pushes over relay sync, fill only that multisig's share of the
 * store, and only settled intents are ever evicted to make room.
 */
import { describe, expect, test } from "bun:test";
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import { intentPlacement, MAX_INTENTS, MAX_INTENTS_PER_MULTISIG } from "../src/intent-capacity";

const FLOODED = "SN_MAIN:0x1";
const OTHER = "SN_MAIN:0x2";

// Placement reads only the account and the lifecycle state.
const intents = (
  accountId: string,
  count: number,
  state: ArgentMultisigSigningIntent["state"] = "collecting",
): ArgentMultisigSigningIntent[] =>
  Array.from({ length: count }, () => ({ accountId, state }) as ArgentMultisigSigningIntent);

describe("intent placement", () => {
  test("a multisig at its own bound is full, while another multisig still fits", () => {
    const stored = intents(FLOODED, MAX_INTENTS_PER_MULTISIG);
    expect(intentPlacement(stored, FLOODED)).toEqual({ fits: false });
    expect(intentPlacement(stored, OTHER)).toEqual({ fits: true });
  });

  test("a multisig at its own bound evicts only one of its own settled intents", () => {
    const stored = [
      ...intents(OTHER, 1, "accepted"),
      ...intents(FLOODED, MAX_INTENTS_PER_MULTISIG - 1),
      ...intents(FLOODED, 1, "rejected"),
    ];
    expect(intentPlacement(stored, FLOODED)).toEqual({ evict: stored.length - 1, fits: true });
  });

  test("the wallet-wide bound still holds, evicting any settled intent", () => {
    const perAccount = MAX_INTENTS / 4;
    const stored = ["SN_MAIN:0x3", "SN_MAIN:0x4", "SN_MAIN:0x5", "SN_MAIN:0x6"].flatMap(
      (accountId) => intents(accountId, perAccount),
    );
    expect(intentPlacement(stored, OTHER)).toEqual({ fits: false });
    const settled = stored.map((intent, index) =>
      index === 7 ? { ...intent, state: "stale" as const } : intent,
    );
    expect(intentPlacement(settled, OTHER)).toEqual({ evict: 7, fits: true });
  });

  test("open intents are never evicted", () => {
    for (const state of ["collecting", "ready", "submitted"] as const) {
      expect(intentPlacement(intents(FLOODED, MAX_INTENTS_PER_MULTISIG, state), FLOODED)).toEqual({
        fits: false,
      });
    }
  });
});
