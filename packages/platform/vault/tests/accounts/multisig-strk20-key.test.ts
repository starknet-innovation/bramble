/**
 * Multisig STRK20 viewing-key records: first offer wins, a different offer
 * conflicts without replacing it, and the gift-wrap plaintext round-trips.
 */
import { describe, expect, test } from "bun:test";
import {
  acceptMultisigStrk20Key,
  canonicalMultisigStrk20Scope,
  forgetMultisigStrk20Key,
  hasValidMultisigStrk20VaultData,
  MAX_MULTISIG_STRK20_VIEWING_KEYS,
  MULTISIG_STRK20_VIEWING_KEY_SCHEME,
  type MultisigStrk20KeyLedger,
  multisigStrk20KeyPackageContent,
  multisigStrk20KeyState,
  readMultisigStrk20KeyPackage,
} from "@bramble/vault/multisig-strk20-key";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";

const CHAIN = STARKNET_NETWORKS.SN_MAIN.chainId;
const POOL = "0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const MULTISIG = `SN_MAIN:0x${"ab".repeat(16)}`;
const KEY = "0x654321";
const OTHER = "0x111";

const scope = canonicalMultisigStrk20Scope(MULTISIG, CHAIN, POOL);
if (!scope) throw new Error("fixture scope");

const ref = {
  ...scope,
  scheme: MULTISIG_STRK20_VIEWING_KEY_SCHEME,
  viewingKey: KEY,
} as const;

const empty: MultisigStrk20KeyLedger = { conflicts: [], keys: [] };

describe("multisig STRK20 viewing keys", () => {
  test("stores the first key and treats the same offer as already held", () => {
    const stored = acceptMultisigStrk20Key(empty, ref);
    if (!stored) throw new Error("stored");
    expect(stored.result).toBe("stored");
    expect(multisigStrk20KeyState(stored.ledger, scope)).toBe("held");
    const again = acceptMultisigStrk20Key(stored.ledger, ref);
    expect(again).toEqual({ ledger: stored.ledger, result: "held" });
    expect(hasValidMultisigStrk20VaultData(stored?.ledger.keys, stored?.ledger.conflicts)).toBe(
      true,
    );
  });

  test("keeps the stored key when a co-owner offers a different one", () => {
    const stored = acceptMultisigStrk20Key(empty, ref);
    const conflict = acceptMultisigStrk20Key(stored?.ledger ?? empty, {
      ...ref,
      viewingKey: OTHER,
    });
    expect(conflict?.result).toBe("conflict");
    expect(conflict?.ledger.keys).toEqual(stored?.ledger.keys);
    expect(conflict?.ledger.conflicts).toEqual([
      { chainId: CHAIN, multisigId: MULTISIG, poolAddress: POOL },
    ]);
    expect(multisigStrk20KeyState(conflict?.ledger ?? empty, scope)).toBe("conflict");
    const repeated = acceptMultisigStrk20Key(conflict?.ledger ?? empty, {
      ...ref,
      viewingKey: OTHER,
    });
    expect(repeated?.result).toBe("conflict");
    expect(repeated?.ledger.conflicts).toHaveLength(1);
  });

  test("forgets the local key and its conflict mark", () => {
    const stored = acceptMultisigStrk20Key(empty, ref);
    const conflict = acceptMultisigStrk20Key(stored?.ledger ?? empty, {
      ...ref,
      viewingKey: OTHER,
    });
    const forgotten = forgetMultisigStrk20Key(conflict?.ledger ?? empty, scope);
    expect(forgotten?.removed).toBe(true);
    expect(forgotten?.ledger).toEqual(empty);
    expect(multisigStrk20KeyState(forgotten?.ledger ?? empty, scope)).toBe("absent");
  });

  test("round-trips the gift-wrap plaintext and refuses a non-canonical key", () => {
    const content = multisigStrk20KeyPackageContent(ref);
    expect(content).toContain(KEY);
    expect(readMultisigStrk20KeyPackage(content ?? "")).toEqual({ ...scope, key: KEY });
    expect(
      readMultisigStrk20KeyPackage(JSON.stringify({ ...JSON.parse(content ?? ""), extra: 1 })),
    ).toBe(null);
    expect(
      readMultisigStrk20KeyPackage(
        JSON.stringify({ ...JSON.parse(content ?? ""), viewingKey: "0x0654321" }),
      ),
    ).toBeNull();
  });

  test("refuses a scope whose chain is not the multisig's network", () => {
    expect(
      canonicalMultisigStrk20Scope(MULTISIG, STARKNET_NETWORKS.SN_SEPOLIA.chainId, POOL),
    ).toBeNull();
    expect(acceptMultisigStrk20Key(empty, { ...ref, chainId: "0x1" })).toBeNull();
  });

  test("refuses one past the collection limit instead of evicting", () => {
    let ledger = empty;
    for (let index = 1; index <= MAX_MULTISIG_STRK20_VIEWING_KEYS; index += 1) {
      const address = `0x${index.toString(16)}`;
      const nextScope = canonicalMultisigStrk20Scope(`SN_MAIN:${address}`, CHAIN, POOL);
      if (!nextScope) throw new Error("scope");
      const next = acceptMultisigStrk20Key(ledger, { ...ref, ...nextScope });
      if (!next) throw new Error("store");
      ledger = next.ledger;
    }
    const overflow = canonicalMultisigStrk20Scope(`SN_MAIN:0x${"ff".repeat(16)}`, CHAIN, POOL);
    expect(
      acceptMultisigStrk20Key(ledger, { ...ref, ...(overflow ?? scope), viewingKey: OTHER }),
    ).toBeNull();
  });
});
