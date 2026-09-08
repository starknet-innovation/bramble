/**
 * The two things a reviewer has to be told about a SNIP-12 `merkletree` field:
 * the felt the pinned library hashes that field down to, and the pair topology
 * that felt actually commits to.
 *
 * The pinned `MerkleTree` commutes siblings and nothing else. `MerkleTree.hash`
 * sorts its two operands before hashing, so exchanging the two children of one
 * node leaves the root alone; `MerkleTree.build` pairs strictly by array index
 * and pads a trailing odd element against the constant `0x0`, so moving a leaf
 * into a different pair — or into the padded position — changes the root. A card
 * that ordered all the leaves together would therefore print one receipt for
 * trees the account signs different roots for, which is why the pairing is
 * mirrored here rather than approximated: {@link snip12MerkleLayout} normalizes
 * exactly the exchanges the root is invariant under, and no others.
 *
 * Trust boundary: every argument is untrusted dapp input of any shape. Nothing
 * here throws, nothing here decides whether a payload may be signed
 * (`isTypedDataShape` in `./typed-data.ts` is that gate), and a root this cannot
 * obtain from the library is reported as `null` rather than derived a second
 * way — a displayed root that the signing path would not produce would be worse
 * than no root at all.
 */

import { canonicalFelt, isStarkFieldElement } from "@bramble/wallet-model/networks";
import { typedData as snip12 } from "starknet";
import type { Snip12Revision } from "./snip12-vocabulary";

/**
 * Where one leaf sits in the tree the pinned library would build.
 *
 * `index` is the leaf's position in the payload's own array, which is how the
 * caller finds the rows it already decoded. `group` names the node the leaf
 * hangs off: one letter per level above its own pair, `a` and `b` chosen by this
 * module's canonical order rather than by the payload's. Leaves that share a
 * `group` are the ones the root hashes together, and the two members of a pair
 * share it exactly because their order is the one thing the root does not fix.
 */
export type Snip12MerklePlacement = {
  readonly group: string;
  readonly index: number;
};

type MutablePlacement = { group: string; index: number };

type LayoutNode = {
  readonly key: string;
  readonly placed: MutablePlacement[];
};

// The canonical order has to be a function of leaf *content*, never of the
// payload's ordering: ranking the distinct keys is what makes two permutations
// of one multiset agree on which sibling is `a`. Ranks also keep a node key
// short, so the walk stays linear in the number of leaves rather than in the
// number of bytes they carry.
const leafRanks = (leafKeys: readonly string[]): ReadonlyMap<string, number> => {
  const ranks = new Map<string, number>();
  for (const key of [...new Set(leafKeys)].sort()) {
    ranks.set(key, ranks.size);
  }
  return ranks;
};

const prefixGroup = (node: LayoutNode, letter: string): void => {
  for (const placement of node.placed) {
    placement.group = `${letter}${placement.group}`;
  }
};

// One node with two real children. The children commute, so the node's identity
// is the *unordered* pair: they are ordered by their own canonical keys, and
// only then does each side take its letter.
const paired = (left: LayoutNode, right: LayoutNode, labelled: boolean): LayoutNode => {
  const flipped = right.key < left.key;
  const low = flipped ? right : left;
  const high = flipped ? left : right;
  if (labelled) {
    prefixGroup(low, "a");
    prefixGroup(high, "b");
  }
  return { key: `(${low.key},${high.key})`, placed: [...low.placed, ...high.placed] };
};

// A trailing odd node is hashed against `0x0`, which is a constant and not a
// sibling: nothing commutes with it, so it takes no letter and keeps its child.
const padded = (child: LayoutNode): LayoutNode => ({
  key: `[${child.key}]`,
  placed: child.placed,
});

/**
 * Places every merkle leaf in the tree the pinned library would build over it,
 * given one key per leaf that stands for everything the card would print for
 * that leaf.
 *
 * The result is the order the leaves should be shown in and the group each one
 * belongs to. Two leaf orderings reach the same result exactly when they reach
 * the same root, so a receipt built from it neither hides a topology the account
 * signs nor invents an order the account does not.
 *
 * Trust boundary: the keys are derived from untrusted input and are compared,
 * never interpreted. This never throws; an empty leaf list — which the library
 * cannot build a root over at all — places nothing.
 */
export const snip12MerkleLayout = (
  leafKeys: readonly string[],
): readonly Snip12MerklePlacement[] => {
  const ranks = leafRanks(leafKeys);
  let level: LayoutNode[] = leafKeys.map((key, index) => ({
    key: String(ranks.get(key) ?? 0),
    placed: [{ group: "", index }],
  }));
  // The bottom level pairs leaves with each other, and a leaf's position inside
  // its own pair is the one thing the root does not commit to — so that level
  // orders the two siblings but hands out no letter, and the pair itself becomes
  // the group both leaves are addressed by.
  let labelled = false;
  while (level.length > 1) {
    const next: LayoutNode[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      if (!left) {
        continue;
      }
      const right = level[index + 1];
      next.push(right ? paired(left, right, labelled) : padded(left));
    }
    level = next;
    labelled = true;
  }
  const root = level[0];
  return root ? root.placed : [];
};

/**
 * Reads back the merkle root the pinned library hashes a `merkletree` field to,
 * by asking the library's own encoder for it under the field's declaring type
 * and name — the same call the message hash is built from, so the felt shown is
 * the felt signed.
 *
 * Trust boundary: `types` and `leaves` are untrusted dapp input of any shape.
 * This never throws and never runs away; it returns `null` whenever the library
 * refuses the field, whenever the declaring type does not name it as a
 * merkletree, and — the one case a `try` would not save — whenever the leaf list
 * is empty, because `build([])` recurses on `[]` forever rather than throwing.
 * It also returns `null` when the result is not a field element. Callers must
 * only reach it for payloads `isTypedDataShape` accepts: the encoder's cost and
 * recursion are bounded by that gate's budgets, not by this function.
 */
export const snip12MerkleRoot = (
  types: Record<string, unknown>,
  parentType: string,
  fieldName: string,
  leaves: unknown,
  revision: Snip12Revision,
): string | null => {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    return null;
  }
  try {
    const [, encoded] = snip12.encodeValue(
      types as never,
      "merkletree",
      leaves as never,
      { key: fieldName, parent: parentType },
      revision as never,
    ) as readonly [string, unknown];
    return typeof encoded === "string" && isStarkFieldElement(encoded)
      ? canonicalFelt(encoded)
      : null;
  } catch {
    return null;
  }
};
