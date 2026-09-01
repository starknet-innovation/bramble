/**
 * MCW-V09-104, merkle half, together with the topology correction the external
 * review of that fix asked for: a `merkletree` root commits to the leaf multiset
 * *and* to the way the leaves are paired, and to nothing else. The sign card must
 * therefore show the pairing and the root it produces, while never printing an
 * ordinal the root does not cover.
 *
 * The pinned library's `MerkleTree.hash` sorts its two operands before hashing
 * (`const [aSorted,bSorted] = [BigInt(a),BigInt(b)].sort(…)`), so exchanging the
 * two children of one node leaves the root alone. `MerkleTree.build`, however,
 * pairs strictly by array index and pads a trailing odd element against `0x0`,
 * so moving a leaf into a different pair — or into the padded position — does
 * change the root. Round 2 decoded a merkletree as a plain array, so
 * `claims[0].who` read as a hashed position the signature does not cover; the
 * fix then over-corrected and ordered every leaf together, so two trees the
 * account signs different roots for rendered byte-identically.
 *
 * Both halves are pinned here, and both directions are asserted against the
 * library first so neither could pass against a card that showed nothing:
 * orderings the root cannot distinguish must render alike, and orderings it can
 * distinguish must not. The same walk also refuses an empty leaf list, which the
 * library cannot hash at all: `new MerkleTree([])` recurses `build([]) ->
 * build([])` with no base case, so a payload carrying one must never reach it.
 * That half is pinned at the gate in
 * tests/starknet/typed-data-value-conformance.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@mc-wallet/core/json";
import { isTypedDataShape, typedDataHash } from "@mc-wallet/starknet/typed-data";
import { hash, typedData as snip12 } from "starknet";
import { signRequestView } from "../../../../src/sidepanel/shared/sign-request";
import {
  SIGNED_MESSAGE_LABEL,
  signBlockBody,
  signHtml,
  UNSIGNED_MESSAGE_LABEL,
} from "../../../support/sign-request-blocks";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];
const LEAF_TYPES = {
  Leaf: [
    { name: "to", type: "ContractAddress" },
    { name: "amt", type: "u128" },
  ],
  Msg: [{ contains: "Leaf", name: "tree", type: "merkletree" }],
  StarknetDomain: DOMAIN_TYPE,
};

const batch = (leaves: Json): Json => ({
  domain: { chainId: "SN_SEPOLIA", name: "Batch", revision: "1" },
  message: { tree: leaves },
  primaryType: "Msg",
  types: LEAF_TYPES,
});

const w = { amt: "1", to: "0x1" };
const x = { amt: "2", to: "0x2" };
const y = { amt: "3", to: "0x3" };
const z = { amt: "999999", to: "0xdead" };

const signedBlock = (leaves: Json): string =>
  signBlockBody(signHtml(batch(leaves)), SIGNED_MESSAGE_LABEL) as string;

const numbered = (count: number): readonly Json[] =>
  Array.from({ length: count }, (_, index) => ({
    amt: String(index + 1),
    to: `0x${index + 1}`,
  }));

const permutations = <T>(items: readonly T[]): T[][] =>
  items.length <= 1
    ? [[...items]]
    : items.flatMap((item, index) =>
        permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
          item,
          ...rest,
        ]),
      );

const ROOT_ROW = /sign-key">tree ⟨merkle root⟩<\/span><span class="sign-val">([^<]*)</;

const rootOf = (block: string): string => ROOT_ROW.exec(block)?.[1] ?? "";

const record = (into: Map<string, Set<string>>, key: string, value: string): void => {
  const seen = into.get(key) ?? new Set<string>();
  seen.add(value);
  into.set(key, seen);
};

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
    // …and neither rendering claims a position the root does not cover. A tree
    // of one pair has no grouping to state at all: both leaves are hashed
    // together, and which of them the library hashes first is not signed.
    expect(signedBlock(forward)).not.toContain("tree[0]");
    expect(signedBlock(forward)).toContain("tree{}.to");
    // Both recipients are still shown as signed content: the leaf *set* is part
    // of what the root commits to, and every leaf value is in it.
    expect(signedBlock(forward)).toContain("0x1111");
    expect(signedBlock(forward)).toContain("0xdeadbeef");
  });

  test("every four-leaf permutation the root cannot distinguish renders identically", () => {
    // Sibling order and whole-subtree order are both uncommitted; leaf *pairing*
    // is not, which is why `[w,y,x,z]` is a different hash and is asserted so —
    // otherwise this test would pass against a renderer that showed nothing.
    const same: readonly Json[] = [
      [w, x, y, z],
      [x, w, y, z],
      [w, x, z, y],
      [y, z, w, x],
      [z, y, x, w],
    ];
    const baseline = typedDataHash(batch(same[0] as Json), ACCOUNT);
    for (const ordering of same) {
      expect(typedDataHash(batch(ordering), ACCOUNT)).toBe(baseline);
      expect(signedBlock(ordering)).toBe(signedBlock(same[0] as Json));
    }
    expect(typedDataHash(batch([w, y, x, z]), ACCOUNT)).not.toBe(baseline);
  });

  test("leaf orderings the root does distinguish never render alike", () => {
    // The exact inverse of the case above, and the one the round-3 renderer got
    // wrong: same multiset, different pairing, different signed hash — so the
    // two receipts must not be the same bytes.
    expect(typedDataHash(batch([w, y, x, z]), ACCOUNT)).not.toBe(
      typedDataHash(batch([w, x, y, z]), ACCOUNT),
    );
    expect(signedBlock([w, y, x, z])).not.toBe(signedBlock([w, x, y, z]));

    // An odd leaf count pads the trailing element against `0x0`, which is a
    // constant and not a sibling: that position is hashed and must be visible.
    expect(typedDataHash(batch([y, w, x]), ACCOUNT)).not.toBe(
      typedDataHash(batch([w, x, y]), ACCOUNT),
    );
    expect(signedBlock([y, w, x])).not.toBe(signedBlock([w, x, y]));

    // Duplicate leaves keep both their multiplicity and their topology.
    expect(typedDataHash(batch([w, w, x, y]), ACCOUNT)).not.toBe(
      typedDataHash(batch([w, x, y, w]), ACCOUNT),
    );
    expect(signedBlock([w, w, x, y])).not.toBe(signedBlock([w, x, y, w]));
  });

  test("receipt partitions leaf orderings exactly as the root does", () => {
    // The invariant as a bijection rather than as prose: no root may show two
    // receipts (sibling order is not signed and must not be shown), and no
    // receipt may cover two roots (pairing IS signed and must be visible).
    for (const count of [2, 3, 4, 5]) {
      const rootToReceipt = new Map<string, Set<string>>();
      const receiptToRoot = new Map<string, Set<string>>();
      for (const ordering of permutations(numbered(count))) {
        const root = typedDataHash(batch(ordering), ACCOUNT);
        const receipt = signedBlock(ordering);
        record(rootToReceipt, root, receipt);
        record(receiptToRoot, receipt, root);
      }
      for (const receipts of rootToReceipt.values()) {
        expect(receipts.size).toBe(1);
      }
      for (const roots of receiptToRoot.values()) {
        expect(roots.size).toBe(1);
      }
      expect(receiptToRoot.size).toBe(rootToReceipt.size);
    }
  });

  test("a repairing that leaf order alone cannot show is still visible", () => {
    // Seven leaves is where showing the leaves in a canonical order stops being
    // enough on its own: these two orderings reduce to the same canonical leaf
    // sequence yet reach different roots, because the leaves are grouped
    // differently. Only the grouping the card prints beside each leaf tells them
    // apart, which is why it is not decoration.
    const leaves = numbered(7);
    const rotated = [...leaves.slice(3), ...leaves.slice(0, 3)];
    expect(typedDataHash(batch(rotated as Json), ACCOUNT)).not.toBe(
      typedDataHash(batch(leaves as Json), ACCOUNT),
    );

    const straight = signedBlock(leaves as Json);
    const shuffled = signedBlock(rotated as Json);
    expect(shuffled).not.toBe(straight);
    // Both receipts list the same leaves in the same order — the difference is
    // entirely in which leaves are grouped together.
    expect(straight).toContain("tree{aa}.to");
    expect(straight).toContain("tree{bb}.to");
    expect(straight.indexOf("0x7")).toBeGreaterThan(straight.indexOf("0x1"));
    expect(shuffled.indexOf("0x7")).toBeGreaterThan(shuffled.indexOf("0x1"));
    // …and no group reads as a payload-chosen position.
    expect(straight).not.toContain("tree[0]");
    expect(straight).not.toContain("tree{0}");
  });

  test("the root the field hashes to is shown as signed content", () => {
    const leaves = [w, x];
    const [first, second] = leaves.map((leaf) =>
      BigInt(snip12.getStructHash(LEAF_TYPES as never, "Leaf", leaf as never, "1" as never)),
    ) as [bigint, bigint];
    // Recomputed from the library's own struct hashes and merkle hash rather
    // than from the card's helper, so the row is checked against the encoding
    // the account signs and not against itself.
    const expected = hash.computePoseidonHash(
      first < second ? first : second,
      first < second ? second : first,
    );

    expect(rootOf(signedBlock(leaves))).toBe(expected);
    // The root moves when the pairing moves, which is what keeps the receipt
    // injective even where the row cap or a truncated value hides a leaf.
    const paired = rootOf(signedBlock([w, x, y, z]));
    const repaired = rootOf(signedBlock([w, y, x, z]));
    expect(paired).toMatch(/^0x[0-9a-f]+$/);
    expect(repaired).not.toBe(paired);
    // …and it does not move when only sibling order does.
    expect(rootOf(signedBlock([x, w, z, y]))).toBe(paired);
  });

  test("no root is claimed for a payload the hashing gate refuses", () => {
    // The card renders payloads the gate refuses, and the root is read back from
    // the pinned library — which may only be handed an envelope that gate has
    // already bounded. A refused payload therefore shows leaves but no root.
    const payload = {
      domain: { chainId: "SN_SEPOLIA", name: "Batch", revision: "1", version: "1" },
      message: { tree: [w, x] },
      primaryType: "Msg",
      types: LEAF_TYPES,
    };
    expect(isTypedDataShape(payload)).toBe(false);
    const block = signBlockBody(signHtml(payload), SIGNED_MESSAGE_LABEL) as string;
    expect(block).toContain("tree{}.to");
    expect(block).not.toContain("⟨merkle root⟩");
  });

  test("a merkle field nested inside another struct is grouped and rooted too", () => {
    // The root is read back under the type that *declares* the field, not under
    // the primary type, so a merkletree one level down must not silently lose
    // its root row — which is what a walk that only tracked the top type would
    // do.
    const view = signRequestView({
      domain: { chainId: "SN_SEPOLIA", name: "Batch", revision: "1" },
      message: { inner: { tree: [w, x, y] } },
      primaryType: "Msg",
      types: {
        Inner: [{ contains: "Leaf", name: "tree", type: "merkletree" }],
        Leaf: LEAF_TYPES.Leaf,
        Msg: [{ name: "inner", type: "Inner" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });

    expect(view.classified).toBe(true);
    const block = signBlockBody(view.html, SIGNED_MESSAGE_LABEL) as string;
    expect(block).toContain("inner.tree ⟨merkle root⟩");
    // Two leaves paired, the odd one padded on its own: the groups say which.
    expect(block).toContain("inner.tree{a}.to");
    expect(block).toContain("inner.tree{b}.to");
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

  test("a merkle field that is not a list at all is never shown as signed", () => {
    const view = signRequestView(batch("0x1"));
    expect(view.classified).toBe(false);
    expect(signBlockBody(view.html, SIGNED_MESSAGE_LABEL)).not.toContain("tree");
    expect(signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL)).toContain("tree");
  });
});
