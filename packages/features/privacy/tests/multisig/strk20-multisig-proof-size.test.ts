/**
 * Real STARK proofs in the multisig STRK20 store. A proof's bytes may be up to
 * `STRK20_LIMITS.proofDataCharacters` long, and every key on the provider
 * budget is charged six bytes per character, so proof bytes kept inline in
 * the shared row could never be written. The third live mainnet round failed
 * there with "Invalid JSON value"; every earlier test stored a two-character
 * stand-in.
 */
import { describe, expect, test } from "bun:test";
import type { MultisigStrk20RelayRequest } from "@bramble/privacy/multisig-strk20";
import { createMultisigStrk20Store } from "@bramble/privacy/multisig-strk20-store";
import { createMemoryStore, type KeyValueStore } from "@bramble/store/kv";
import { canonicalFelt, STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { STRK20_LIMITS } from "@bramble/wallet-protocol/strk20";

const ACCOUNT_ID = `SN_MAIN:0x${"1".repeat(63)}`;
const INTENT_ID = `${ACCOUNT_ID}:0x${"a".repeat(63)}`;
// A relay's id ends in its proof's last fact.
const STRK = canonicalFelt(STRK_TOKEN_ADDRESS) ?? "0x1";
const RELAY_ID = `${ACCOUNT_ID}:0x9`;
// The largest proof the protocol accepts.
const PROOF = {
  data: "A".repeat(STRK20_LIMITS.proofDataCharacters),
  output: ["0x1"],
  proof_facts: ["0x1", "0x2", "0x3", "0x4", "0x64", "0x6", "0x7", "0x1", "0x9"],
};

const relay = (data: string): MultisigStrk20RelayRequest => ({
  accountAddress: `0x${"1".repeat(63)}`,
  accountId: ACCOUNT_ID,
  call: { calldata: ["0x1"], contractAddress: "0x9001", entrypoint: "apply_actions" },
  feeAction: { amount: "0x5", recipient: "0x4", token: STRK, type: "withdraw" },
  fragments: [],
  id: RELAY_ID,
  proof: { ...PROOF, data },
  request: { amount: "0x10", kind: "transfer", recipient: "0x6", token: STRK },
  signerPublicKeys: ["0x11", "0x22"],
  state: "ready",
  summary: "Transfer from this multisig's private balance",
  threshold: 2,
});

// Every key the store writes, so a test can tell what is left behind.
const keyed = (): { readonly keys: () => readonly string[]; readonly store: KeyValueStore } => {
  const inner = createMemoryStore();
  const keys = new Set<string>();
  return {
    keys: () => [...keys],
    store: {
      get: (key) => inner.get(key),
      async remove(key) {
        keys.delete(key);
        await inner.remove(key);
      },
      async set(key, value) {
        await inner.set(key, value);
        keys.add(key);
      },
    },
  };
};

describe("proof bytes of a real size", () => {
  test("a proof at the protocol limit is stored and read back whole", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    await expect(
      store.putProof({ intentId: INTENT_ID, proof: PROOF, request: { kind: "register" } }),
    ).resolves.toBe("stored");
    expect((await store.getProof(INTENT_ID))?.proof.data).toBe(PROOF.data);
  });

  test("a relay at the protocol limit is stored, read back whole, and conflicts by its bytes", async () => {
    const store = createMultisigStrk20Store(createMemoryStore());
    await expect(store.upsertRelay(relay(PROOF.data))).resolves.toBe("stored");
    expect((await store.getRelay(RELAY_ID))?.proof.data).toBe(PROOF.data);
    // The same relay again is the same row; other proof bytes are a conflict.
    await expect(store.upsertRelay(relay(PROOF.data))).resolves.toBe("stored");
    await expect(store.upsertRelay(relay("B".repeat(1_000)))).resolves.toBe("conflict");
  });

  test("dropping or purging leaves no proof bytes behind", async () => {
    const { keys, store: kv } = keyed();
    const store = createMultisigStrk20Store(kv);
    await store.putProof({ intentId: INTENT_ID, proof: PROOF, request: { kind: "register" } });
    await store.upsertRelay(relay(PROOF.data));
    expect(keys().length).toBeGreaterThan(1);
    await store.dropProof(INTENT_ID);
    await expect(store.getProof(INTENT_ID)).resolves.toBeNull();
    await store.purgeAccount(ACCOUNT_ID);
    await expect(store.getRelay(RELAY_ID)).resolves.toBeNull();
    // Only the shared row remains, and it holds no proof bytes.
    expect(keys()).toEqual(["bramble:argent-multisig-strk20:v1"]);
    expect(JSON.stringify(await kv.get("bramble:argent-multisig-strk20:v1"))).not.toContain("AAAA");
  });
});
