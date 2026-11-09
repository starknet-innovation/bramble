/** Session-only recovery discovery cache validation. */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { createRecoveryDiscoveryCache } from "../../../apps/extension/src/background/onboarding/recovery-cache";

const account: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: "0x123",
  classHash: "0x456",
  derivation: { accountIndex: 2, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN",
  publicKeyX: "0x789",
  publicKeyY: "0xabc",
};

describe("recovery discovery cache", () => {
  test("retains validated public progress and ignores malformed session data", async () => {
    const store = createMemoryStore();
    const cache = createRecoveryDiscoveryCache(store);
    const snapshot = {
      candidates: [{ account, deployed: true, funded: false }],
      fingerprint: "0x123",
      networkId: "SN_MAIN",
      nextIndex: 4,
    } as const;

    await cache.write(snapshot);
    expect(await cache.read()).toEqual(snapshot);

    await store.set("bramble:recovery-discovery", { ...snapshot, mnemonic: "must not persist" });
    expect(await cache.read()).toBeNull();
  });
});
