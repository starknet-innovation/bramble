/** The presented multisig id is stored, cleared, and rejected when malformed. */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import { createPreferencesStore } from "../src/preferences";

const ACCOUNT = "SN_MAIN:0x123";

describe("selected multisig preference", () => {
  test("stores a presented multisig and clears it", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    expect((await preferences.read()).selectedMultisigId).toBeUndefined();
    await preferences.setSelectedMultisig({ multisigId: ACCOUNT });
    expect((await preferences.read()).selectedMultisigId).toBe(ACCOUNT);
    await preferences.setSelectedMultisig({ multisigId: null });
    expect((await preferences.read()).selectedMultisigId).toBeUndefined();
  });

  test("rejects a malformed id", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    await expect(preferences.setSelectedMultisig({ multisigId: "nope" })).rejects.toThrow(
      "Invalid account",
    );
  });
});
