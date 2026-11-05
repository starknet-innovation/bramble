/**
 * The real Krusty adapter's QSB disclosure calls against the BIP: the digest
 * of its `binding_encoding` vector, and preimages that hash to the very
 * commitments Krusty derives for the same phrase and vault, in the order
 * asked. Every phrase here is a published test vector.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";

const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
const PHRASE = "all all all all all all all all all all all all";
// The BIP's `binding_encoding` vector (vectors.json).
const BIP_VECTOR = {
  binding: "d50c25f740af092cc115965a317beae0d72397eabd2b0495148de1c5e6bd2c4e",
  digest: "eb9907c687e2a86336eb342d649b7c41e030f4eafe4129072377828e0eb57405",
  round0: [0, 1, 2, 3, 4, 5, 6, 7],
  round1: [140, 141, 142, 143, 144, 145, 146],
  transaction:
    "020000000111111111111111111111111111111111111111111111111111111111111111110000000000ffffffff01e803000000000000015100000000",
} as const;
const ROUND0 = [77, 3, 140, 12, 9, 0, 149, 45];
const ROUND1 = [5, 100, 4, 99, 33, 22, 11];

const hash160 = (hex: string): string =>
  createHash("ripemd160")
    .update(createHash("sha256").update(Buffer.from(hex, "hex")).digest())
    .digest("hex");

describe("Krusty's QSB disclosure", () => {
  test("answers the BIP's binding vector", async () => {
    expect(
      await kms.qsbRevealDigest(BIP_VECTOR.transaction, BIP_VECTOR.round0, BIP_VECTOR.round1),
    ).toEqual({ binding: BIP_VECTOR.binding, digest: BIP_VECTOR.digest });
  });

  test("a different index order is a different digest", async () => {
    const reordered = [BIP_VECTOR.round0[1], BIP_VECTOR.round0[0], ...BIP_VECTOR.round0.slice(2)];
    const digest = await kms.qsbRevealDigest(
      BIP_VECTOR.transaction,
      reordered as number[],
      BIP_VECTOR.round1,
    );
    expect(digest.binding).toBe(BIP_VECTOR.binding);
    expect(digest.digest).not.toBe(BIP_VECTOR.digest);
  });

  test("reveals the preimages of its own commitments, in the order asked", async () => {
    const commitments = await kms.deriveQsbCommitments(PHRASE, 3);
    const preimages = await kms.revealQsbPreimages(PHRASE, 3, ROUND0, ROUND1);
    const expected: (string | undefined)[] = [
      ...ROUND0.map((index) => commitments.round0[index]),
      ...ROUND1.map((index) => commitments.round1[index]),
    ];
    expect(preimages.map(hash160)).toEqual(expected as string[]);
  });
});
