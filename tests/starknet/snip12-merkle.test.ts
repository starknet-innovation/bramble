/**
 * The two things the sign approval card is allowed to say about a `merkletree`
 * field, pinned directly against the pinned library.
 *
 * `snip12MerkleLayout` mirrors `MerkleTree.build`: it must normalize exactly the
 * sibling exchanges the root is invariant under and no others, and it must do so
 * as a function of leaf *content* — a canonicalizer that ranked leaves by where
 * they happened to appear would hand two permutations of one multiset two
 * different layouts, which is the whole defect it exists to prevent.
 *
 * `snip12MerkleRoot` reads the root back out of the library rather than deriving
 * it a second way, so its contract is about what it refuses: it must answer
 * `null`, never a guess and never a hang, for every field the library would not
 * encode.
 */
import { describe, expect, test } from "bun:test";
import { snip12MerkleLayout, snip12MerkleRoot } from "@mc-wallet/starknet/snip12-merkle";
import { hash, typedData as snip12 } from "starknet";

const TYPES = {
  Leaf: [
    { name: "to", type: "ContractAddress" },
    { name: "amt", type: "u128" },
  ],
  Msg: [{ contains: "Leaf", name: "tree", type: "merkletree" }],
  StarknetDomain: [
    { name: "name", type: "shortstring" },
    { name: "chainId", type: "shortstring" },
    { name: "revision", type: "shortstring" },
  ],
};

const leaves = (count: number): Record<string, string>[] =>
  Array.from({ length: count }, (_, index) => ({ amt: String(index + 1), to: `0x${index + 1}` }));

// The layout as the card would read it: every leaf's group beside the leaf it
// belongs to, in the order the card would print them.
const shown = (keys: readonly string[]): string =>
  snip12MerkleLayout(keys)
    .map((placement) => `{${placement.group}}${keys[placement.index]}`)
    .join(" ");

describe("snip12MerkleLayout", () => {
  test("places nothing for a leaf list the library cannot build a root over", () => {
    expect(snip12MerkleLayout([])).toEqual([]);
  });

  test("a lone leaf and a lone pair carry no grouping at all", () => {
    // Nothing above a single leaf, and within one pair the two members commute —
    // so there is no grouping either case is entitled to state.
    expect(shown(["a"])).toBe("{}a");
    expect(shown(["a", "b"])).toBe("{}a {}b");
    expect(shown(["b", "a"])).toBe("{}a {}b");
  });

  test("groups are assigned by leaf content, never by payload position", () => {
    // The canonical order has to be a function of the multiset: if it ranked
    // leaves by first appearance, these two permutations would lay out
    // differently and the receipt would once again depend on the site's order.
    const forward = ["m", "z", "a", "q"];
    for (const ordering of [
      ["z", "m", "a", "q"],
      ["a", "q", "m", "z"],
      ["q", "a", "z", "m"],
    ]) {
      expect(shown(ordering)).toBe(shown(forward));
    }
  });

  test("a leaf moved into another pair is laid out differently", () => {
    expect(shown(["a", "b", "c", "d"])).not.toBe(shown(["a", "c", "b", "d"]));
    // Every leaf still appears exactly once, so nothing is hidden by the change.
    expect(
      snip12MerkleLayout(["a", "c", "b", "d"])
        .map((placement) => placement.index)
        .sort(),
    ).toEqual([0, 1, 2, 3]);
  });

  test("a trailing odd leaf takes no letter from the sibling it does not have", () => {
    // `build` pads the odd element against the constant `0x0`, which commutes
    // with nothing — so that leaf's group is shorter than its peers', and the
    // padded position stays visible instead of reading as an ordinary pair.
    expect(shown(["a", "b", "c"])).toBe("{a}a {a}b {b}c");
    expect(shown(["a", "b", "c", "d", "e"])).toBe("{aa}a {aa}b {ab}c {ab}d {b}e");
  });

  test("identical leaves keep their multiplicity", () => {
    expect(shown(["a", "a", "b", "b"])).toBe("{a}a {a}a {b}b {b}b");
    expect(shown(["a", "b", "a", "b"])).toBe("{a}a {a}b {b}a {b}b");
    expect(shown(["a", "a", "b", "b"])).not.toBe(shown(["a", "b", "a", "b"]));
  });
});

describe("snip12MerkleRoot", () => {
  test("reports the root the library's own encoder produces", () => {
    const pair = leaves(2);
    const hashes = pair.map((leaf) =>
      BigInt(snip12.getStructHash(TYPES as never, "Leaf", leaf as never, "1" as never)),
    ) as [bigint, bigint];
    const expected = hash.computePoseidonHash(
      hashes[0] < hashes[1] ? hashes[0] : hashes[1],
      hashes[0] < hashes[1] ? hashes[1] : hashes[0],
    );
    expect(snip12MerkleRoot(TYPES, "Msg", "tree", pair, "1")).toBe(expected);
  });

  test("moves with the pairing and not with sibling order", () => {
    const [a, b, c, d] = leaves(4) as [
      Record<string, string>,
      Record<string, string>,
      Record<string, string>,
      Record<string, string>,
    ];
    const baseline = snip12MerkleRoot(TYPES, "Msg", "tree", [a, b, c, d], "1");
    expect(baseline).toMatch(/^0x[0-9a-f]+$/);
    expect(snip12MerkleRoot(TYPES, "Msg", "tree", [b, a, d, c], "1")).toBe(baseline);
    expect(snip12MerkleRoot(TYPES, "Msg", "tree", [c, d, a, b], "1")).toBe(baseline);
    expect(snip12MerkleRoot(TYPES, "Msg", "tree", [a, c, b, d], "1")).not.toBe(baseline);
  });

  test("refuses an empty leaf list rather than looping forever", () => {
    // `new MerkleTree([])` recurses `build([]) -> build([])` with no base case:
    // it neither returns nor throws, so a `try` would not save the caller. The
    // guard is the only thing that keeps this call total.
    expect(snip12MerkleRoot(TYPES, "Msg", "tree", [], "1")).toBeNull();
    expect(snip12MerkleRoot(TYPES, "Msg", "tree", "0x1", "1")).toBeNull();
  });

  test("refuses a field its declaring type does not name as a merkletree", () => {
    expect(snip12MerkleRoot(TYPES, "Nope", "tree", leaves(2), "1")).toBeNull();
    expect(snip12MerkleRoot(TYPES, "Msg", "nope", leaves(2), "1")).toBeNull();
    expect(snip12MerkleRoot(TYPES, "Msg", "tree", [{ to: "not a felt" }], "1")).toBeNull();
    expect(snip12MerkleRoot({}, "Msg", "tree", leaves(2), "1")).toBeNull();
  });

  test("refuses a leaf type the revision cannot resolve", () => {
    // Revision 0 has no `ContractAddress` preset and no enum vocabulary, so the
    // encoder's answer for the same declaration is a different question — the
    // caller passes the payload's own revision and this never assumes one.
    const declared = { ...TYPES, Msg: [{ contains: "Missing", name: "tree", type: "merkletree" }] };
    expect(snip12MerkleRoot(declared, "Msg", "tree", leaves(2), "1")).toBeNull();
  });
});
