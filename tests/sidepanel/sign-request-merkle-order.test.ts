/**
 * MCW-V09-104, merkle half: a `merkletree` root commits to the *set* of leaf
 * hashes, never to their order, so the sign card must not print an ordinal for a
 * merkle leaf inside the signed block.
 *
 * The pinned library's `MerkleTree.hash` sorts its two operands before hashing
 * (`const [aSorted,bSorted] = [BigInt(a),BigInt(b)].sort(…)`), which makes the
 * root invariant under permutations of sibling subtrees. Round 2 decoded a
 * merkletree as a plain array, so `claims[0].who` read as a hashed position that
 * the signature does not cover: a site could reorder its own leaves and change
 * which recipient appeared first while the account signed the same hash.
 *
 * Every test here asserts the collision first — the pinned library really does
 * hash the two orderings identically — and then that the card renders them
 * identically. The same walk also refuses an empty leaf list, which the library
 * cannot hash at all: `new MerkleTree([])` recurses `build([]) -> build([])`
 * with no base case, so a payload carrying one must never reach it. That half is
 * pinned at the gate in tests/starknet/typed-data-value-conformance.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "../../src/shared/json";
import { signRequestView } from "../../src/sidepanel/sign-request";
import { isTypedDataShape, typedDataHash } from "../../src/starknet/typed-data";
import {
  SIGNED_MESSAGE_LABEL,
  signBlockBody,
  signHtml,
  UNSIGNED_MESSAGE_LABEL,
} from "../support/sign-request-blocks";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];

const batch = (leaves: readonly Json[]): Json => ({
  domain: { chainId: "SN_SEPOLIA", name: "Batch", revision: "1" },
  message: { tree: leaves },
  primaryType: "Msg",
  types: {
    Leaf: [
      { name: "to", type: "ContractAddress" },
      { name: "amt", type: "u128" },
    ],
    Msg: [{ contains: "Leaf", name: "tree", type: "merkletree" }],
    StarknetDomain: DOMAIN_TYPE,
  },
});

const w = { amt: "1", to: "0x1" };
const x = { amt: "2", to: "0x2" };
const y = { amt: "3", to: "0x3" };
const z = { amt: "999999", to: "0xdead" };

const signedBlock = (leaves: readonly Json[]): string =>
  signBlockBody(signHtml(batch(leaves)), SIGNED_MESSAGE_LABEL) as string;

describe("sign card merkle leaves", () => {
  test("two leaf orderings that hash alike render alike", () => {
    const forward = [
      { amt: "1", to: "0x1111" },
      { amt: "999999999999", to: "0xdeadbeef" },
    ];
    const reversed = [...forward].reverse();
    // The collision is real: swapping the leaves is invisible to the signer.
    expect(typedDataHash(batch(reversed), ACCOUNT)).toBe(typedDataHash(batch(forward), ACCOUNT));

    expect(signedBlock(reversed)).toBe(signedBlock(forward));
    // …and neither rendering claims a position the root does not cover.
    expect(signedBlock(forward)).not.toContain("tree[0]");
    expect(signedBlock(forward)).toContain("tree{}.to");
    // Both recipients are still shown as signed content: the leaf *set* is what
    // the root commits to, and every leaf value is in it.
    expect(signedBlock(forward)).toContain("0x1111");
    expect(signedBlock(forward)).toContain("0xdeadbeef");
  });

  test("every four-leaf permutation the root cannot distinguish renders identically", () => {
    // Sibling order and whole-subtree order are both uncommitted; leaf *pairing*
    // is not, which is why `[w,y,x,z]` is a different hash and is asserted so —
    // otherwise this test would pass against a renderer that showed nothing.
    const same: readonly (readonly Json[])[] = [
      [w, x, y, z],
      [x, w, y, z],
      [w, x, z, y],
      [y, z, w, x],
      [z, y, x, w],
    ];
    const baseline = typedDataHash(batch(same[0] as readonly Json[]), ACCOUNT);
    for (const ordering of same) {
      expect(typedDataHash(batch(ordering), ACCOUNT)).toBe(baseline);
      expect(signedBlock(ordering)).toBe(signedBlock(same[0] as readonly Json[]));
    }
    expect(typedDataHash(batch([w, y, x, z]), ACCOUNT)).not.toBe(baseline);
  });

  test("array element order, unlike leaf order, is hashed and is shown", () => {
    // The contrast that makes the merkle rule a rule rather than a habit: an
    // ordinary `T*` array hashes its elements in order, so its rows keep their
    // ordinals.
    const list = (items: readonly Json[]): Json => ({
      domain: { chainId: "SN_SEPOLIA", name: "Batch", revision: "1" },
      message: { items },
      primaryType: "Msg",
      types: {
        Leaf: [{ name: "amt", type: "u128" }],
        Msg: [{ name: "items", type: "Leaf*" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });
    const forward = [{ amt: "1" }, { amt: "2" }];
    expect(typedDataHash(list([...forward].reverse()), ACCOUNT)).not.toBe(
      typedDataHash(list(forward), ACCOUNT),
    );
    expect(signBlockBody(signHtml(list(forward)), SIGNED_MESSAGE_LABEL)).toContain("items[0].amt");
  });

  test("undeclared keys inside a merkle leaf are still split out", () => {
    const view = signRequestView(
      batch([
        { amt: "1", chainId: "SN_MAIN", to: "0x1" },
        { amt: "2", to: "0x2" },
      ]),
    );

    expect(view.classified).toBe(true);
    expect(signBlockBody(view.html, SIGNED_MESSAGE_LABEL)).not.toContain("SN_MAIN");
    expect(signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL)).toContain("tree{}.chainId");
    expect(signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL)).toContain("SN_MAIN");
  });

  test("a merkle field with no leaves is never shown as signed", () => {
    // The library never terminates building a root over no leaves, so the card
    // must not report an empty list as covered by a hash that does not exist.
    const payload = batch([]);
    expect(isTypedDataShape(payload)).toBe(false);

    const view = signRequestView(payload);
    expect(view.classified).toBe(false);
    expect(signBlockBody(view.html, SIGNED_MESSAGE_LABEL)).not.toContain("tree");
    expect(signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL)).toContain("tree");
  });
});
