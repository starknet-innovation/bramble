/**
 * SNIP-12 typed data validation and hashing for off-chain message signing.
 *
 * Trust boundary: every value here arrives from a dapp through the content
 * script and is fully untrusted. The SNIP-12 message hash is derived from
 * `encodeType`, a flat string built by concatenating type names and field names
 * with `(`, `)`, `,`, `:` (and `"` on revision 1) as the only separators —
 * neither revision escapes those characters inside a name. A name carrying a
 * separator therefore lets two different type graphs reassemble into the same
 * `encodeType` string and produce an identical message hash, so a user can be
 * shown one structure and sign another.
 *
 * Both revisions are closed the same way: a deny-by-default name grammar
 * (`isSafeSnip12Name` in `./snip12-vocabulary`, shared with the approval card so
 * one rule governs every name that is hashed or printed) that admits no
 * separator and no non-ASCII code point, applied to every type name, field name,
 * field type, and tuple element. With no separator reachable inside a name the
 * flat string parses back to exactly one type graph, so the reviewed structure is
 * the signed structure.
 * `tests/starknet/typed-data-injectivity.test.ts` pins that by differential
 * search against the pinned library rather than by argument. Refusing revision 0
 * outright is therefore not needed to close the forgery, and would break the
 * dapps still signing revision 0.
 *
 * Each revision is validated against its own vocabulary — `./snip12-vocabulary`
 * describes what each encoder resolves — because they resolve different things:
 * revision 0 has no preset structs, no enums and no tuples, and coerces any
 * field type it cannot resolve to a felt instead of throwing. Only types that
 * revision's own encoder resolves are admitted, so nothing is ever silently
 * reinterpreted as a felt.
 *
 * Two constructs need more than the grammar, because their shape never reaches
 * `encodeType` at all:
 *
 * - `merkletree` omits its `contains` leaf type from the encoding, so a payload
 *   declaring `felt` leaves whose values are another struct's hashes reaches the
 *   same root as the struct-leaf payload — one message hash covering two
 *   structures. A leaf must therefore name a declared struct or a preset, never
 *   a basic type: a struct leaf hashes as `H(typeHash, …values)`, so reproducing
 *   a target leaf set means finding a hash preimage rather than typing it out.
 * - An `enum` field encodes as `"f":"Variants"`, indistinguishable from a plain
 *   reference to the same type. The two are kept disjoint by shape instead: a
 *   type named by some enum's `contains` is a variant list — at least one field,
 *   every field a tuple payload — and is reachable only through that enum field,
 *   while every other type may hold no tuple at all. Their encodings then differ
 *   wherever the graphs do, and neither can be hashed as the other.
 */

import { WalletError } from "@mc-wallet/core/errors";
import {
  hasOnlyKnownKeys,
  hasUniqueStrings,
  isJsonWithinBudget,
  isRecord,
  JSON_BUDGETS,
  type Json,
} from "@mc-wallet/core/json";
import { isStarkFieldElement } from "@mc-wallet/wallet-model/networks";
import { typedData as snip12 } from "starknet";
import {
  BASIC_TYPES,
  CONTAINER_TYPES,
  ENUM_TYPE,
  identifyRevision,
  isSafeSnip12Name as isSafeName,
  REVISION_KEY,
  REVISION_RULES,
  type RevisionRules,
  type Snip12Field,
} from "./snip12-vocabulary";
import { conformsToTypeGraph, type Snip12TypeGraph } from "./typed-data-values";

type TypeGraph = Snip12TypeGraph;

const readField = (value: unknown): Snip12Field | undefined => {
  if (!isRecord(value) || !hasOnlyKnownKeys(value, ["contains", "name", "type"])) {
    return undefined;
  }
  const contains = value["contains"];
  const name = value["name"];
  const type = value["type"];
  if (typeof name !== "string" || typeof type !== "string" || !isSafeName(name)) {
    return undefined;
  }
  if (contains === undefined) {
    return { name, type };
  }
  return typeof contains === "string" ? { contains, name, type } : undefined;
};

const readTypeGraph = (
  types: Record<string, unknown>,
  rules: RevisionRules,
): TypeGraph | undefined => {
  const graph = new Map<string, readonly Snip12Field[]>();
  for (const [name, definition] of Object.entries(types)) {
    if (!isSafeName(name) || rules.reserved.has(name) || !Array.isArray(definition)) {
      return undefined;
    }
    const fields: Snip12Field[] = [];
    for (const entry of definition) {
      const field = readField(entry);
      if (!field) {
        return undefined;
      }
      fields.push(field);
    }
    if (!hasUniqueStrings(fields.map((field) => field.name))) {
      return undefined;
    }
    graph.set(name, fields);
  }
  return graph;
};

const isTupleType = (type: string): boolean => type.startsWith("(") && type.endsWith(")");

// The type names some `enum` field points its `contains` at. Their declarations
// are variant lists rather than structs, and `encodeType` spells an enum field
// exactly like a plain reference to the same name, so the two must never both
// be reachable for one name.
const variantLists = (graph: TypeGraph, rules: RevisionRules): ReadonlySet<string> => {
  const targets = new Set<string>();
  if (!rules.containers.has(ENUM_TYPE)) {
    return targets;
  }
  for (const fields of graph.values()) {
    for (const field of fields) {
      if (field.type === ENUM_TYPE && field.contains !== undefined) {
        targets.add(field.contains);
      }
    }
  }
  return targets;
};

// A leaf, preset, or declared struct reference, optionally an array of one. A
// variant list is not one: the encoder cannot hash it as a struct value.
const isTypeReference = (
  type: string,
  graph: TypeGraph,
  rules: RevisionRules,
  variants: ReadonlySet<string>,
): boolean => {
  const base = type.endsWith("*") ? type.slice(0, -1) : type;
  return (
    isSafeName(base) &&
    !variants.has(base) &&
    (BASIC_TYPES.has(base) || rules.presets.has(base) || graph.has(base))
  );
};

// An enum variant's payload, e.g. `(felt,u128)`. `encodeType` escapes each
// element separately, so validating them individually keeps the encoding
// unambiguous; `()` is the no-payload variant.
const isTupleReference = (
  type: string,
  graph: TypeGraph,
  rules: RevisionRules,
  variants: ReadonlySet<string>,
): boolean => {
  const inner = type.slice(1, -1);
  return (
    inner.length === 0 ||
    inner.split(",").every((element) => isTypeReference(element, graph, rules, variants))
  );
};

// A merkle leaf must hash as a struct: `contains` never enters `encodeType`, so
// only the leaf *values* can bind the declared shape, and a struct leaf binds it
// through `H(typeHash, …values)`. A basic-type leaf is the raw felt the site
// supplied, which is exactly the substitution this refuses.
const isMerkleLeaf = (
  contains: string,
  graph: TypeGraph,
  rules: RevisionRules,
  variants: ReadonlySet<string>,
): boolean =>
  !contains.endsWith("*") &&
  !variants.has(contains) &&
  (graph.has(contains) || rules.presets.has(contains));

const isValidField = (
  field: Snip12Field,
  graph: TypeGraph,
  rules: RevisionRules,
  variants: ReadonlySet<string>,
  inVariantList: boolean,
): boolean => {
  if (inVariantList) {
    // A variant list holds nothing but tuple payloads, which is what keeps its
    // encoding distinguishable from an ordinary struct's.
    return (
      field.contains === undefined &&
      rules.tuples &&
      isTupleType(field.type) &&
      isTupleReference(field.type, graph, rules, variants)
    );
  }
  if (CONTAINER_TYPES.has(field.type)) {
    // `enum` resolves its variants by indexing the declared types directly, so
    // `contains` must name a declared type; `merkletree` needs a struct leaf.
    if (!rules.containers.has(field.type) || field.contains === undefined) {
      return false;
    }
    return field.type === ENUM_TYPE
      ? graph.has(field.contains)
      : isMerkleLeaf(field.contains, graph, rules, variants);
  }
  if (field.contains !== undefined || isTupleType(field.type)) {
    return false;
  }
  return isTypeReference(field.type, graph, rules, variants);
};

const isUnambiguousGraph = (
  graph: TypeGraph,
  rules: RevisionRules,
  variants: ReadonlySet<string>,
): boolean => {
  for (const name of variants) {
    // An undeclared or empty variant list has no variant the encoder can pick.
    if ((graph.get(name)?.length ?? 0) === 0) {
      return false;
    }
  }
  return [...graph.entries()].every(([name, fields]) =>
    fields.every((field) => isValidField(field, graph, rules, variants, variants.has(name))),
  );
};

// The revision's own domain struct must be declared, and no domain key may sit
// outside that declaration: an undeclared key contributes nothing to the hash,
// so accepting one lets a site show a chain or a name it never signed.
const isSupportedDomain = (
  domain: Record<string, unknown>,
  graph: TypeGraph,
  rules: RevisionRules,
  variants: ReadonlySet<string>,
): boolean => {
  const declared = graph.get(rules.domainType);
  if (!declared || variants.has(rules.domainType)) {
    return false;
  }
  const hashed = new Set(declared.map((field) => field.name));
  return Object.keys(domain).every((key) => key === REVISION_KEY || hashed.has(key));
};

const hasTypedDataEnvelope = (
  value: unknown,
): value is Json & Record<"domain" | "message" | "primaryType" | "types", unknown> =>
  isRecord(value) &&
  isJsonWithinBudget(value, JSON_BUDGETS.typedData) &&
  hasOnlyKnownKeys(value, ["domain", "message", "primaryType", "types"]) &&
  isRecord(value["types"]) &&
  typeof value["primaryType"] === "string" &&
  value["primaryType"].length > 0 &&
  isRecord(value["domain"]) &&
  isRecord(value["message"]);

/**
 * Checks that untrusted input is a SNIP-12 envelope this wallet is willing to
 * hash: bounded JSON, a revision the pinned library identifies, that revision's
 * domain struct declared with no undeclared domain key beside it, a primary
 * type that is actually declared, a type graph in which every type name, field
 * name, and field type is unambiguous under `encodeType` and resolvable by that
 * revision's encoder, and domain and message values that hold the shape those
 * declarations describe (see `./typed-data-values`). Anything else is rejected
 * outright — there is no partial acceptance, because a name that can reassemble
 * `encodeType`, or a value the encoder reads differently from how it reads, makes
 * the reviewed structure and the signed structure two different things.
 */
export const isTypedDataShape = (
  value: unknown,
): value is Json & Record<"domain" | "message" | "primaryType" | "types", unknown> => {
  if (!hasTypedDataEnvelope(value)) {
    return false;
  }
  const types = value["types"] as Record<string, unknown>;
  const domain = value["domain"] as Record<string, unknown>;
  const revision = identifyRevision(types, domain);
  if (revision === null) {
    return false;
  }
  const rules = REVISION_RULES[revision];
  const graph = readTypeGraph(types, rules);
  if (!graph) {
    return false;
  }
  const variants = variantLists(graph, rules);
  const primaryType = value["primaryType"] as string;
  return (
    graph.has(primaryType) &&
    !variants.has(primaryType) &&
    isUnambiguousGraph(graph, rules, variants) &&
    isSupportedDomain(domain, graph, rules, variants) &&
    // The graph names one structure; `conformsToTypeGraph` then checks the
    // values actually hold it, so the library is never handed a payload it would
    // hash by prototype lookup, by indexing a string, or by looping forever.
    conformsToTypeGraph(domain, rules.domainType, graph, rules) &&
    conformsToTypeGraph(value["message"], primaryType, graph, rules)
  );
};

/**
 * Computes the SNIP-12 message hash an account signs for typed data. Throws a
 * `WalletError` — never a partial or fallback hash — when the envelope is not
 * one this wallet accepts, when the library cannot hash it, or when the result
 * is not a field element. Callers treat a throw as "refuse to sign".
 */
export const typedDataHash = (data: unknown, accountAddress: string): string => {
  if (!isTypedDataShape(data)) {
    throw new WalletError("Invalid typed data");
  }
  let messageHash: string;
  try {
    messageHash = snip12.getMessageHash(
      data as unknown as Parameters<typeof snip12.getMessageHash>[0],
      accountAddress,
    );
  } catch {
    throw new WalletError("Typed data cannot be hashed");
  }
  if (!isStarkFieldElement(messageHash)) {
    throw new WalletError("Typed data produced an invalid hash");
  }
  return messageHash;
};
