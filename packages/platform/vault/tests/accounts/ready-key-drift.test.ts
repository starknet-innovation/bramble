/**
 * Pins how pre-3.0 Ready keys are spotted: only `argentx-bip44` accounts are
 * re-derived, each from its own phrase (founding or imported), and only their
 * public keys are compared.
 */
import { describe, expect, test } from "bun:test";
import { findPreFixReadyAccountIds } from "../../src/accounts/ready-key-drift";

const FOUNDING = "founding phrase";
const IMPORTED = "imported phrase";
const felt = (digit: string): string => `0x${digit.repeat(63)}`;

// Full-length felts: a short stub would hide a canonicalization slip.
const readyAccount = (id: string, addressIndex: number, publicKeyX: string, seedId?: string) => ({
  derivation: {
    addressIndex,
    kind: "argentx-bip44" as const,
    ...(seedId === undefined ? {} : { seedId }),
  },
  id,
  publicKeyX,
});

const kmsDeriving = (keys: Record<string, string>) => {
  const calls: [string, number][] = [];
  return {
    calls,
    kms: {
      async deriveArgentLegacyPublicKey(mnemonic: string, addressIndex: number) {
        calls.push([mnemonic, addressIndex]);
        const key = keys[`${mnemonic}:${addressIndex}`];
        if (key === undefined) throw new Error("unexpected derivation");
        return key;
      },
    },
  };
};

type VaultArg = Parameters<typeof findPreFixReadyAccountIds>[1];
const vaultWith = (accounts: readonly unknown[], mnemonic: string | null = FOUNDING) =>
  ({
    accounts,
    importedSeeds: [{ id: "seed-1", mnemonic: IMPORTED }],
    mnemonic,
  }) as unknown as VaultArg;

describe("findPreFixReadyAccountIds", () => {
  test("flags only Ready accounts whose stored key differs from today's derivation", async () => {
    const { calls, kms } = kmsDeriving({
      [`${FOUNDING}:0`]: felt("a"),
      [`${FOUNDING}:1`]: felt("c"),
      [`${IMPORTED}:2`]: felt("e"),
    });
    const vault = vaultWith([
      readyAccount("current", 0, felt("a")),
      readyAccount("pre-fix", 1, felt("b")),
      readyAccount("imported-pre-fix", 2, felt("f"), "seed-1"),
      { derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" }, id: "oz" },
      { derivation: { kind: "imported" }, id: "raw" },
    ]);

    await expect(findPreFixReadyAccountIds(kms, vault)).resolves.toEqual([
      "pre-fix",
      "imported-pre-fix",
    ]);
    expect(calls).toEqual([
      [FOUNDING, 0],
      [FOUNDING, 1],
      [IMPORTED, 2],
    ]);
  });

  test("compares felts numerically, not as text", async () => {
    const { kms } = kmsDeriving({ [`${FOUNDING}:0`]: `0x0${"a".repeat(63)}` });
    await expect(
      findPreFixReadyAccountIds(kms, vaultWith([readyAccount("same", 0, felt("a"))])),
    ).resolves.toEqual([]);
  });

  test("skips accounts whose phrase is gone instead of guessing", async () => {
    const { calls, kms } = kmsDeriving({});
    const vault = vaultWith(
      [readyAccount("founding", 0, felt("a")), readyAccount("lost", 1, felt("b"), "missing")],
      null,
    );
    await expect(findPreFixReadyAccountIds(kms, vault)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  test("propagates a Krusty failure rather than reporting no affected accounts", async () => {
    const kms = {
      async deriveArgentLegacyPublicKey(): Promise<string> {
        throw new Error("krusty unavailable");
      },
    };
    await expect(
      findPreFixReadyAccountIds(kms, vaultWith([readyAccount("x", 0, felt("a"))])),
    ).rejects.toThrow("krusty unavailable");
  });
});
