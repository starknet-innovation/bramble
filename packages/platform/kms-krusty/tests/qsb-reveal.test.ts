/**
 * The Krusty adapter's QSB disclosure calls: the digest of `T` and the reveal
 * of 15 preimages. Inputs are refused before Krusty sees them — a `T` that is
 * not the BIP's empty-scriptSig legacy form, indices that are not 8 and 7
 * distinct values below 150 — and the order given is the order passed, never
 * sorted. Krusty's digest must equal the one recomputed here; its preimages
 * must be exactly 15 lowercase 20-byte values. The real module's answers are
 * pinned in `check:krusty` and tests/background/qsb/qsb-krusty-reveal.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import { bitcoinExports, preimagesResult, revealDigestResult } from "./bitcoin-exports";

const PHRASE = "all all all all all all all all all all all all";
// The BIP's `binding_encoding` vector (vectors.json): a one-input T, its
// binding B and the digest D for these exact indices.
const BIP_VECTOR = {
  binding: "d50c25f740af092cc115965a317beae0d72397eabd2b0495148de1c5e6bd2c4e",
  digest: "eb9907c687e2a86336eb342d649b7c41e030f4eafe4129072377828e0eb57405",
  round0: [0, 1, 2, 3, 4, 5, 6, 7],
  round1: [140, 141, 142, 143, 144, 145, 146],
  transaction:
    "020000000111111111111111111111111111111111111111111111111111111111111111110000000000ffffffff01e803000000000000015100000000",
} as const;
// Unsorted, as a solution's prefix never is but a caller might pass.
const ROUND0 = [77, 3, 140, 12, 9, 0, 149, 45];
const ROUND1 = [5, 100, 4, 99, 33, 22, 11];

const moduleWith = (overrides: Record<string, unknown> = {}) => {
  const unused = () => {
    throw new Error("not under test");
  };
  return {
    ...Object.fromEntries(
      [
        "deriveArgentLegacyKeypair",
        "deriveNostrPublicKey",
        "deriveOzAccountAddress",
        "deriveScopedStrk20ViewingKey",
        "deriveStarknetKeypair",
        "generateMnemonic",
        "getAccountClassHashes",
        "openNostrApplicationData",
        "signStarkHash",
        "validateMnemonic",
        "wrapNostrApplicationData",
      ].map((name) => [name, unused]),
    ),
    ...bitcoinExports(overrides),
  };
};

const kmsWith = (overrides: Record<string, unknown> = {}) => createKrustyKms(moduleWith(overrides));

describe("the adapter requires both disclosure exports", () => {
  test.each(["qsbRevealDigest", "revealQsbPreimages"])("refuses a module without %s", (name) => {
    expect(() => kmsWith({ [name]: undefined })).toThrow(`Krusty KMS export missing: ${name}`);
  });
});

describe("qsbRevealDigest", () => {
  test("hands Krusty T and copies of the indices in the order given", async () => {
    const calls: unknown[][] = [];
    const kms = kmsWith({
      qsbRevealDigest: (...args: unknown[]) => {
        calls.push(args);
        return revealDigestResult(BIP_VECTOR.transaction, ROUND0, ROUND1);
      },
    });
    expect(await kms.qsbRevealDigest(BIP_VECTOR.transaction, ROUND0, ROUND1)).toEqual(
      revealDigestResult(BIP_VECTOR.transaction, ROUND0, ROUND1),
    );
    expect(calls).toEqual([[BIP_VECTOR.transaction, ROUND0, ROUND1]]);
    expect(calls[0]?.[1]).not.toBe(ROUND0);
  });

  test("refuses a digest that is not the one T and the indices give", async () => {
    const sorted = revealDigestResult(BIP_VECTOR.transaction, [...ROUND0].sort(), ROUND1);
    for (const answer of [
      sorted,
      { ...revealDigestResult(BIP_VECTOR.transaction, ROUND0, ROUND1), binding: "00".repeat(32) },
      { binding: 1, digest: 2 },
      "not an object",
    ]) {
      await expect(
        kmsWith({ qsbRevealDigest: () => answer }).qsbRevealDigest(
          BIP_VECTOR.transaction,
          ROUND0,
          ROUND1,
        ),
      ).rejects.toThrow("Krusty KMS");
    }
  });

  test.each([
    [
      "a witness serialization",
      `${BIP_VECTOR.transaction.slice(0, 8)}0001${BIP_VECTOR.transaction.slice(8)}`,
    ],
    [
      "a non-empty scriptSig",
      BIP_VECTOR.transaction.replace("0000000000ffffffff", "00000000015100ffffffff"),
    ],
    ["trailing bytes", `${BIP_VECTOR.transaction}00`],
    ["uppercase hex", BIP_VECTOR.transaction.toUpperCase()],
    ["an empty string", ""],
  ])("refuses %s as T", async (_label, transaction) => {
    let called = false;
    const kms = kmsWith({
      qsbRevealDigest: () => {
        called = true;
      },
    });
    await expect(kms.qsbRevealDigest(transaction, ROUND0, ROUND1)).rejects.toThrow(
      "Invalid QSB disclosure digest input",
    );
    expect(called).toBe(false);
  });

  test.each([
    ["seven round-0 indices", ROUND0.slice(1), ROUND1],
    ["a repeated round-0 index", [...ROUND0.slice(1), ROUND0[1]], ROUND1],
    ["index 150", [...ROUND0.slice(1), 150], ROUND1],
    ["a fractional index", [...ROUND0.slice(1), 1.5], ROUND1],
    ["eight round-1 indices", ROUND0, [...ROUND1, 6]],
    ["a typed array", Uint8Array.from(ROUND0) as unknown as number[], ROUND1],
  ])("refuses %s", async (_label, round0, round1) => {
    await expect(
      kmsWith().qsbRevealDigest(BIP_VECTOR.transaction, round0 as number[], round1),
    ).rejects.toThrow("Invalid QSB disclosure digest input");
  });
});

describe("revealQsbPreimages", () => {
  test("asks Krusty for the mainnet namespace with the indices in order", async () => {
    const calls: unknown[][] = [];
    const kms = kmsWith({
      revealQsbPreimages: (...args: unknown[]) => {
        calls.push(args);
        return preimagesResult(ROUND0, ROUND1);
      },
    });
    expect(await kms.revealQsbPreimages(PHRASE, 7, ROUND0, ROUND1)).toEqual(
      preimagesResult(ROUND0, ROUND1),
    );
    expect(calls).toEqual([[PHRASE, 0, 7, ROUND0, ROUND1]]);
  });

  test("refuses anything but 15 lowercase 20-byte preimages", async () => {
    const good = preimagesResult(ROUND0, ROUND1);
    for (const answer of [
      good.slice(1),
      [...good, good[0]],
      [good[0]?.toUpperCase(), ...good.slice(1)],
      [good[0]?.slice(2), ...good.slice(1)],
      "not a list",
    ]) {
      await expect(
        kmsWith({ revealQsbPreimages: () => answer }).revealQsbPreimages(PHRASE, 0, ROUND0, ROUND1),
      ).rejects.toThrow("Krusty KMS returned invalid QSB preimages");
    }
  });

  test.each([
    ["a phrase that is not mnemonic text", "  ", 0, ROUND0, ROUND1],
    ["vault 2^31", PHRASE, 2 ** 31, ROUND0, ROUND1],
    ["vault -1", PHRASE, -1, ROUND0, ROUND1],
    ["six round-1 indices", PHRASE, 0, ROUND0, ROUND1.slice(1)],
  ])("refuses %s before Krusty is asked", async (_label, phrase, v, round0, round1) => {
    let called = false;
    const kms = kmsWith({
      revealQsbPreimages: () => {
        called = true;
      },
    });
    await expect(kms.revealQsbPreimages(phrase, v, round0, round1)).rejects.toThrow(
      "Invalid QSB disclosure input",
    );
    expect(called).toBe(false);
  });
});
