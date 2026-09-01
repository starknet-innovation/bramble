/**
 * The SNIP-12 vocabulary each revision's encoder actually resolves, and which
 * revision the pinned library would pick for a payload.
 *
 * Trust boundary: every argument here arrives from a dapp and is fully
 * untrusted; nothing in this module throws, and nothing in it decides whether a
 * payload may be signed — `isTypedDataShape` in `./typed-data` is that gate.
 * This module only answers "what would revision N's encoder resolve", so the
 * validator and the approval card can both work from one description instead of
 * each guessing.
 *
 * The two revisions are kept strictly apart because their encoders differ:
 * revision 0 predates preset structs, enums and tuples and silently coerces any
 * field type it cannot resolve to a felt, while revision 1 resolves presets from
 * the library even when a payload declares a type of the same name. Sharing a
 * table between them would either hash something the card never showed or show
 * something the hash never covered.
 */
import { isRecord } from "@mc-wallet/core/json";

/**
 * A SNIP-12 revision this wallet signs. The two revisions hash with different
 * functions and resolve different type vocabularies, so nothing may be shared
 * between them without saying which one it belongs to.
 */
export type Snip12Revision = "0" | "1";

/**
 * The longest type or field name this wallet will hash or print. A name is a
 * label, not content: anything longer is a paragraph pretending to be one, and
 * on the approval card it would push the decision controls off screen.
 */
export const SNIP12_MAX_NAME_LENGTH = 64;

// Deny-by-default name grammar. Every SNIP-12 separator is excluded, as is `.`
// — the separator the approval card joins nested paths with, so a flat field
// named `to.address` cannot render as the nested `to` -> `address` — and every
// non-ASCII code point, because a homoglyph or bidi override in a name would
// read as a different structure on the card than the one that gets hashed.
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9 _-]*$/;

/**
 * Checks that a string is a SNIP-12 type or field name this wallet is willing
 * to both hash and display: bounded ASCII carrying no `encodeType` separator,
 * no path separator, and no trailing space.
 *
 * Trust boundary: the argument is untrusted dapp input. This never throws and
 * decides nothing on its own — `isTypedDataShape` applies it to every declared
 * name before hashing, and the approval card applies it to every name it prints
 * so that a key the gate never vetted cannot imitate one it did. The one shared
 * grammar behind both; do not re-derive it locally, or the names the wallet will
 * hash and the names it will show stop being the same set.
 */
export const isSafeSnip12Name = (value: string): boolean =>
  value.length > 0 &&
  value.length <= SNIP12_MAX_NAME_LENGTH &&
  SAFE_NAME.test(value) &&
  !value.endsWith(" ");

/**
 * The domain key that selects the hash method. It binds what the account signs
 * even when the domain type does not declare it as a hashed field, so it is the
 * one domain key allowed to sit outside that declaration.
 */
export const REVISION_KEY = "revision";

/**
 * Leaf types `encodeValue` resolves without a declaration, in both revisions.
 * A payload may reference these freely but may never redeclare one: the encoder
 * would keep using its own meaning while the card showed the declaration.
 */
export const BASIC_TYPES: ReadonlySet<string> = new Set([
  "ClassHash",
  "ContractAddress",
  "bool",
  "felt",
  "i128",
  "selector",
  "shortstring",
  "string",
  "timestamp",
  "u128",
]);

/**
 * The `enum` container field type. Its `contains` names a variant list, which
 * the encoder reads as one selected variant rather than as a struct.
 */
export const ENUM_TYPE = "enum";

/**
 * The `merkletree` container field type. Its `contains` names the leaf type,
 * which never reaches `encodeType` — only the leaf values bind that shape.
 */
export const MERKLETREE_TYPE = "merkletree";

/**
 * The field types whose shape comes from a `contains` reference rather than
 * from the field's own type name.
 */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set([ENUM_TYPE, MERKLETREE_TYPE]);

/**
 * One entry of a SNIP-12 struct declaration. `contains` is only meaningful on
 * the `enum` and `merkletree` container types; everywhere else its presence is
 * a field the user is never shown an explanation for, and is rejected.
 */
export type Snip12Field = {
  readonly contains?: string;
  readonly name: string;
  readonly type: string;
};

/**
 * The revision 1 preset structs and the fields each one actually hashes, copied
 * from the pinned library's `presetTypes`. Revision 0 has no presets at all, so
 * this map is reachable only through the revision 1 rules: a reader that
 * applied it to a revision 0 payload would show fields that revision never
 * hashes. `encodeType` resolves these from the library while `encodeValue`
 * prefers a same-named declaration, so redeclaring one would hash a shape the
 * type hash does not describe — hence they are also reserved names on
 * revision 1.
 */
const PRESET_FIELDS: ReadonlyMap<string, readonly Snip12Field[]> = new Map([
  [
    "NftId",
    [
      { name: "collection_address", type: "ContractAddress" },
      { name: "token_id", type: "u256" },
    ],
  ],
  [
    "TokenAmount",
    [
      { name: "token_address", type: "ContractAddress" },
      { name: "amount", type: "u256" },
    ],
  ],
  [
    "u256",
    [
      { name: "low", type: "u128" },
      { name: "high", type: "u128" },
    ],
  ],
]);

const NO_PRESETS: ReadonlyMap<string, readonly Snip12Field[]> = new Map();

/**
 * What one revision's encoder resolves, and therefore what a payload declaring
 * that revision may contain. Read only through `REVISION_RULES`, never mixed
 * between revisions.
 */
export type RevisionRules = {
  /** Container field types whose `contains` this revision's encoder resolves. */
  readonly containers: ReadonlySet<string>;
  /** The struct name the domain object is hashed against. */
  readonly domainType: string;
  /** Structs resolvable without a declaration. */
  readonly presets: ReadonlyMap<string, readonly Snip12Field[]>;
  /** The revision these rules describe. Carried in the rules themselves so a
   *  leaf reader resolving a scalar cannot be handed one revision's vocabulary
   *  and another revision's encoding rules. */
  readonly revision: Snip12Revision;
  /** Type names a payload may not declare, because a declaration would mean
   *  something different to `encodeType` than to `encodeValue`. */
  readonly reserved: ReadonlySet<string>;
  /** Whether `(a,b)` enum-variant payload types are encodable. */
  readonly tuples: boolean;
};

// Neither domain spelling is reserved: the revision fixes which one is hashed,
// so the other is an inert ordinary struct and refusing it would break the
// common back-compat payload that declares both.
/**
 * The per-revision rules the validator and the reader both work from. Indexed
 * by the revision `identifyRevision` reports, never by a caller's preference.
 */
export const REVISION_RULES: Readonly<Record<Snip12Revision, RevisionRules>> = {
  // Revision 0 predates presets, enums and tuples; its `getDependencies` never
  // walks a tuple or an enum `contains`, and its `encodeValue` falls through to
  // a felt for anything it does not know, so admitting any of them would hash
  // something other than the structure on screen.
  "0": {
    containers: new Set([MERKLETREE_TYPE]),
    domainType: "StarkNetDomain",
    presets: NO_PRESETS,
    reserved: new Set([...BASIC_TYPES, ...CONTAINER_TYPES]),
    revision: "0",
    tuples: false,
  },
  "1": {
    containers: CONTAINER_TYPES,
    domainType: "StarknetDomain",
    presets: PRESET_FIELDS,
    revision: "1",
    reserved: new Set([...BASIC_TYPES, ...CONTAINER_TYPES, ...PRESET_FIELDS.keys()]),
    tuples: true,
  },
};

// The pinned library selects revision 1 on `domain.revision?.toString() === "1"`
// and revision 0 on `(domain.revision ?? "0") === "0"`, checking revision 1
// first. A numeric 1 is therefore revision 1 for the library and is accepted
// here too — refusing it would reject payloads the account would sign — while a
// numeric 0 identifies no revision at all and is refused, exactly as the
// library refuses it. Anything else with a stringifiable shape (an array, say)
// is refused rather than followed: it is not a revision any dapp means to send.
const isRevisionOne = (value: unknown): boolean => value === "1" || value === 1;
const isRevisionZero = (value: unknown): boolean => value === undefined || value === "0";

/**
 * Reports the revision the pinned library would hash a payload under, or null
 * when it would refuse to hash at all.
 *
 * Trust boundary: both arguments are untrusted dapp input. This never throws
 * and never accepts a payload — a resolved revision only says which rule set
 * applies, not that the graph under it is unambiguous.
 */
export const identifyRevision = (
  types: Record<string, unknown>,
  domain: Record<string, unknown>,
): Snip12Revision | null => {
  const declared = domain[REVISION_KEY];
  if (Object.hasOwn(types, REVISION_RULES["1"].domainType) && isRevisionOne(declared)) {
    return "1";
  }
  if (Object.hasOwn(types, REVISION_RULES["0"].domainType) && isRevisionZero(declared)) {
    return "0";
  }
  return null;
};

/**
 * What a payload's own declarations resolve to for a reader: the revision the
 * pinned library would hash it under, the struct its domain object is hashed
 * against, and the preset structs that revision knows.
 *
 * `revision` is null when no revision is identifiable, which is exactly when
 * the library refuses to hash at all; `domainType` is then null too, because
 * no domain field reaches any hash. `presetFields` still falls back to the
 * revision 1 vocabulary in that case, purely so an unsignable payload renders
 * the way the same payload would render once its revision was fixed.
 */
export type Snip12Vocabulary = {
  readonly domainType: string | null;
  readonly presetFields: ReadonlyMap<string, readonly Snip12Field[]>;
  readonly revision: Snip12Revision | null;
};

const UNRESOLVED_VOCABULARY: Snip12Vocabulary = {
  domainType: null,
  presetFields: PRESET_FIELDS,
  revision: null,
};

const VOCABULARIES: Readonly<Record<Snip12Revision, Snip12Vocabulary>> = {
  "0": {
    domainType: REVISION_RULES["0"].domainType,
    presetFields: REVISION_RULES["0"].presets,
    revision: "0",
  },
  "1": {
    domainType: REVISION_RULES["1"].domainType,
    presetFields: REVISION_RULES["1"].presets,
    revision: "1",
  },
};

/**
 * Resolves the vocabulary a SNIP-12 payload would be hashed under, for readers
 * that must render exactly what the hash covers.
 *
 * Trust boundary: the argument is untrusted and may be any shape at all. This
 * never throws and never decides whether a payload may be signed — it reports
 * the revision the pinned library's own `identifyRevision` would pick, or the
 * unresolved vocabulary when the library would pick none. Callers must not
 * treat a resolved revision as acceptance; `isTypedDataShape` is the gate.
 */
export const snip12Vocabulary = (typedData: unknown): Snip12Vocabulary => {
  if (!isRecord(typedData)) {
    return UNRESOLVED_VOCABULARY;
  }
  const types = typedData["types"];
  const domain = typedData["domain"];
  if (!isRecord(types) || !isRecord(domain)) {
    return UNRESOLVED_VOCABULARY;
  }
  const revision = identifyRevision(types, domain);
  return revision === null ? UNRESOLVED_VOCABULARY : VOCABULARIES[revision];
};
