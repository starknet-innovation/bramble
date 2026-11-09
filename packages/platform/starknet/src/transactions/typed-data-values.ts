/**
 * Value-side conformance for a SNIP-12 envelope: does the object a dapp sent
 * actually hold the shape its own type declarations describe.
 *
 * `./typed-data` checks that the *type graph* names exactly one structure. That
 * is not enough on its own, because the pinned library reads values with plain
 * JavaScript indexing and will happily hash something other than the declared
 * shape:
 *
 * - `new MerkleTree([])` recurses on an empty leaf list with no base case, so a
 *   `merkletree` field whose value is `[]` hangs the background service worker
 *   forever rather than throwing. It must never reach the library.
 * - An enum variant payload is read as `variantData[index]`, and a string or an
 *   array-like object is indexable, so `{Pay: "SN_MAIN"}` hashes the letter `S`
 *   under a `(felt)` declaration. Only a real array of exactly the declared
 *   tuple length says what was signed.
 * - A struct field is read as `data[field.name]`, which walks the prototype
 *   chain: a field named `constructor` hashes `Object.prototype.constructor` out
 *   of an empty message. Only an own, enumerable data property is a value the
 *   site actually sent.
 * - A leaf encoder ends at `getHex`, which reads a value as a number when
 *   `BigInt` accepts it and as a short string otherwise, and revision 0
 *   range-checks nothing at all. A `u128` field therefore accepts the prose
 *   "no fee required" and hashes it as a 128-bit number, and a `felt` field
 *   accepts the string "false" and hashes it as a nonzero felt. Only a value
 *   its declared type can actually mean says what was signed, so every leaf is
 *   resolved through the one type-directed reader in `./snip12-scalars`.
 *
 * Each of those is a payload the wallet would otherwise hash while the approval
 * card could not say what the hash covered. Refusing them at the gate keeps one
 * rule: a payload this wallet hashes is a payload the card can fully describe.
 *
 * Trust boundary: every argument is untrusted dapp input of any shape. Nothing
 * here throws or hashes; it only answers "would the declared shape describe this
 * value", and a `false` means the caller must refuse the payload outright.
 */
import { hasOnlyArrayEntries, isOwnDataProperty, isRecord, JSON_BUDGETS } from "@bramble/core/json";
import { snip12Scalar } from "./snip12-scalars";
import {
  ENUM_TYPE,
  MERKLETREE_TYPE,
  type RevisionRules,
  type Snip12Field,
} from "./snip12-vocabulary";

/**
 * The declared types of one payload, keyed by type name — the same map
 * `isTypedDataShape` builds while validating the graph.
 */
export type Snip12TypeGraph = ReadonlyMap<string, readonly Snip12Field[]>;

// Values reaching here have already passed `isJsonWithinBudget` under this same
// budget, so they are finite, acyclic, and no deeper than it allows; the cap is
// derived from that one budget rather than restated so the two cannot drift.
const MAX_DEPTH = JSON_BUDGETS.typedData.maxDepth;

// The value of an own enumerable data property, or null when the key is absent,
// inherited, or an accessor. Wrapped rather than returned bare so a stored
// `undefined` stays distinguishable from a missing key.
const ownValue = (
  record: Record<string, unknown>,
  key: string,
): { readonly value: unknown } | null => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return isOwnDataProperty(descriptor) ? { value: descriptor.value } : null;
};

// A leaf type hashes the value itself, so the value has to be one the declared
// type can mean — not merely a scalar. `snip12Scalar` is that reading, and it is
// the same one the approval card renders from, so a value this admits is a value
// the card can state the signed felt for.
const isLeafValue = (value: unknown, type: string, rules: RevisionRules): boolean =>
  snip12Scalar(value, type, rules.revision) !== null;

const conformsToList = (
  value: unknown,
  element: string,
  graph: Snip12TypeGraph,
  rules: RevisionRules,
  depth: number,
  allowEmpty: boolean,
): boolean =>
  Array.isArray(value) &&
  hasOnlyArrayEntries(value) &&
  (allowEmpty || value.length > 0) &&
  value.every((entry) => conformsToType(entry, element, graph, rules, depth + 1));

// `encodeValue` prefers a declaration over a preset of the same name, so the
// same order is used here; a name resolving to neither is a leaf type.
const fieldsOf = (
  type: string,
  graph: Snip12TypeGraph,
  rules: RevisionRules,
): readonly Snip12Field[] | undefined => graph.get(type) ?? rules.presets.get(type);

function conformsToType(
  value: unknown,
  type: string,
  graph: Snip12TypeGraph,
  rules: RevisionRules,
  depth: number,
): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  if (type.endsWith("*")) {
    return conformsToList(value, type.slice(0, -1), graph, rules, depth, true);
  }
  const fields = fieldsOf(type, graph, rules);
  return fields
    ? conformsToStruct(value, fields, graph, rules, depth)
    : isLeafValue(value, type, rules);
}

// `encodeValue` hashes `Object.entries(value)[0]` and then reads the declared
// tuple positionally, so exactly one variant may be present, it must be one the
// list declares, and its payload must be an array of exactly the declared
// length: a shorter one hashes `undefined`, a longer one hides elements, and a
// non-array is indexed character by character.
const conformsToEnum = (
  value: unknown,
  contains: string | undefined,
  graph: Snip12TypeGraph,
  rules: RevisionRules,
  depth: number,
): boolean => {
  const variants = contains === undefined ? undefined : graph.get(contains);
  if (!variants || !isRecord(value)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  const selected = keys.length === 1 ? keys[0] : undefined;
  if (typeof selected !== "string") {
    return false;
  }
  const declared = variants.find((variant) => variant.name === selected);
  const payload = ownValue(value, selected);
  if (!declared || !payload) {
    return false;
  }
  const inner = declared.type.slice(1, -1);
  const elements = inner.length === 0 ? [] : inner.split(",");
  const tuple: readonly unknown[] | null = Array.isArray(payload.value) ? payload.value : null;
  return (
    tuple !== null &&
    hasOnlyArrayEntries(tuple) &&
    tuple.length === elements.length &&
    elements.every((element, index) =>
      conformsToType(tuple[index], element, graph, rules, depth + 1),
    )
  );
};

const conformsToField = (
  value: unknown,
  field: Snip12Field,
  graph: Snip12TypeGraph,
  rules: RevisionRules,
  depth: number,
): boolean => {
  if (field.contains !== undefined && rules.containers.has(field.type)) {
    return field.type === ENUM_TYPE
      ? conformsToEnum(value, field.contains, graph, rules, depth)
      : // A merkle root over no leaves is not a hash at all: the library loops
        // forever building it, and the card would show an empty list as signed.
        field.type === MERKLETREE_TYPE &&
          conformsToList(value, field.contains, graph, rules, depth, false);
  }
  return conformsToType(value, field.type, graph, rules, depth);
};

// Undeclared keys are deliberately allowed: they contribute nothing to the hash,
// and the approval card is required to show them in its not-signed block rather
// than have them silently dropped here.
function conformsToStruct(
  value: unknown,
  fields: readonly Snip12Field[],
  graph: Snip12TypeGraph,
  rules: RevisionRules,
  depth: number,
): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return fields.every((field) => {
    const own = ownValue(value, field.name);
    return own !== null && conformsToField(own.value, field, graph, rules, depth + 1);
  });
}

/**
 * Checks that an untrusted value holds the shape a declared SNIP-12 type
 * describes: every declared field present as an own data property, every array
 * an array, every merkle tree non-empty, every enum exactly one declared variant
 * with a full tuple payload, and every leaf a value its declared type can mean
 * on this revision.
 *
 * Trust boundary: `value` is untrusted dapp input and `graph`/`rules` come from
 * the validated declarations. This never throws. A `false` result means the
 * pinned library would either hash something the value does not state or fail to
 * terminate, so the caller must refuse the payload rather than hash it.
 */
export const conformsToTypeGraph = (
  value: unknown,
  type: string,
  graph: Snip12TypeGraph,
  rules: RevisionRules,
): boolean => conformsToType(value, type, graph, rules, 0);
