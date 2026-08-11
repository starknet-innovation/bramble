/**
 * Type-directed decode of a SNIP-12 typed-data payload into the rows the sign
 * approval card may present as signed and the rows it must present as unsigned.
 *
 * A SNIP-12 hash only ever covers what a payload's own type declarations name,
 * and the encoder walks the declared shape rather than the value it was handed:
 * a struct hashes its declared field list, an array hashes its elements, and an
 * enum hashes `Object.entries(value)[0]` as `hash(variantIndex, …elements of
 * the variant's declared tuple)`. Anything a value carries beyond that — an
 * undeclared key, a second enum variant, a payload element past the end of the
 * declared tuple, the entire payload of a `()` variant — contributes nothing to
 * the message hash. Rendering such a value verbatim lets a site state facts the
 * signed hash does not commit to (`chainId: SN_MAIN` beside a payload that hashes
 * identically on Sepolia), so this module resolves every value against its
 * declared type and splits the remainder out.
 *
 * The split is total by construction: every value reached is pushed to exactly
 * one of the two lists. Where the declared type does not describe the value at
 * all — an undeclared enum variant, a struct type holding a scalar, a leaf type
 * holding an object, a payload nested past the walk's depth cap — the value is
 * carried as unsigned *and* the split is marked `unclassified`, because a
 * decoder that cannot say what would be signed must not let the card offer to
 * sign it.
 *
 * Trust boundary: every argument is untrusted dapp input of any shape. Nothing
 * here throws, nothing decides whether a payload may be signed
 * (`isTypedDataShape` in `src/starknet/typed-data.ts` is that gate), and the
 * decoder renders payloads that gate refuses.
 */
import { hasOnlyArrayEntries, isRecord } from "../shared/json";
import { type Snip12Field, snip12Vocabulary } from "../starknet/snip12-vocabulary";
import {
  emptySplit,
  isFieldList,
  join,
  MAX_DEPTH,
  ownFieldValue,
  PRIMARY_TYPE_KEY,
  type SignRequestRow,
  type SignRequestSplit,
  type Split,
  sealed,
  structFields,
  unclassified,
  type Vocabulary,
} from "./sign-request-rows";

/**
 * The domain and message splits of one payload.
 */
export type SignRequestDecoding = {
  readonly domain: SignRequestSplit;
  readonly message: SignRequestSplit;
};

function walkField(
  path: string,
  value: unknown,
  field: Snip12Field,
  vocabulary: Vocabulary,
  out: Split,
  depth: number,
): void {
  if (field.type === "enum") {
    walkEnum(path, value, field.contains, vocabulary, out, depth);
    return;
  }
  if (field.type === "merkletree" && field.contains !== undefined) {
    walkMerkle(path, value, field.contains, vocabulary, out, depth);
    return;
  }
  walkType(path, value, field.type, vocabulary, out, depth);
}

// Splits a record against a declared field list: declared fields recurse (and
// stay visible as an em dash when the site omitted them, so a site cannot
// quietly drop a field its own type says is signed), everything else is
// unhashed and is carried out separately.
const walkStruct = (
  path: string,
  record: Record<string, unknown>,
  fields: readonly Snip12Field[],
  vocabulary: Vocabulary,
  out: Split,
  depth: number,
): void => {
  const declared = new Set(fields.map((field) => field.name));
  for (const field of fields) {
    walkField(
      join(path, field.name),
      ownFieldValue(record, field.name),
      field,
      vocabulary,
      out,
      depth + 1,
    );
  }
  for (const [key, value] of Object.entries(record)) {
    if (!declared.has(key)) {
      out.unsigned.push([join(path, key), value]);
    }
  }
};

// `encodeValue` maps over the array it is handed, so every element is hashed and
// none is optional. A non-array value is not something it can map over, and an
// array carrying own properties beyond its indices would hide them from every
// block including the raw view, so neither is presented as signed.
const walkArray = (
  path: string,
  value: unknown,
  element: string,
  vocabulary: Vocabulary,
  out: Split,
  depth: number,
): void => {
  if (!Array.isArray(value) || !hasOnlyArrayEntries(value)) {
    unclassified(out, path, value);
    return;
  }
  if (value.length === 0) {
    out.signed.push([path, value]);
    return;
  }
  value.forEach((entry, index) => {
    walkType(`${path}[${index}]`, entry, element, vocabulary, out, depth + 1);
  });
};

// Sorting key for one decoded leaf. It is built from the decoded rows rather
// than from the leaf object, so two leaves the encoder hashes identically —
// declared fields in either written order — sort to the same place.
const leafOrder = (split: Split): string => {
  try {
    return JSON.stringify([split.signed, split.unsigned]) ?? "";
  } catch {
    return "";
  }
};

// A merkle root commits to the multiset of leaf hashes, never to their order:
// `MerkleTree.hash` sorts its two operands before hashing, so every permutation
// of the leaves reaches the same root. An ordinal in a row key would therefore
// state a position the signed hash does not cover, so leaves are addressed as
// `path{}` and emitted in an order derived from their own decoded rows — two
// payloads the hash cannot tell apart render identically.
const walkMerkle = (
  path: string,
  value: unknown,
  leaf: string,
  vocabulary: Vocabulary,
  out: Split,
  depth: number,
): void => {
  if (!Array.isArray(value) || !hasOnlyArrayEntries(value) || value.length === 0) {
    // An empty or non-array merkle value has no root at all — the pinned
    // library never terminates building one — so nothing here is signed.
    unclassified(out, path, value);
    return;
  }
  const decoded = value.map((entry) => {
    const split = emptySplit();
    walkType(`${path}{}`, entry, leaf, vocabulary, split, depth + 1);
    return { key: leafOrder(split), split };
  });
  decoded.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  for (const { split } of decoded) {
    out.signed.push(...split.signed);
    out.unsigned.push(...split.unsigned);
    out.unresolved.push(...split.unresolved);
  }
};

function walkType(
  path: string,
  value: unknown,
  type: string,
  vocabulary: Vocabulary,
  out: Split,
  depth: number,
): void {
  if (depth > MAX_DEPTH) {
    unclassified(out, path, value);
    return;
  }
  if (type.endsWith("*")) {
    walkArray(path, value, type.slice(0, -1), vocabulary, out, depth);
    return;
  }
  const fields = structFields(vocabulary, type);
  if (fields) {
    // A struct type hashes its declared fields out of a record; anything else
    // under that type is not a value the encoder can hash as the declared
    // shape, so none of it is signed content.
    if (!isRecord(value)) {
      unclassified(out, path, value);
      return;
    }
    walkStruct(path, value, fields, vocabulary, out, depth);
    return;
  }
  // A leaf type hashes the value itself — but only a scalar is a value it can
  // hash. An object or array parked under `felt` is unhashable decoration, and
  // showing it whole would put its keys in the signed block.
  if (typeof value === "object" && value !== null) {
    unclassified(out, path, value);
    return;
  }
  out.signed.push([path, value]);
}

// The encoder reads a variant payload as `variantType.slice(1, -1).split(",")`
// and hashes exactly that many elements: `()` hashes none of them, and the
// payload's own length is never consulted. Whichever variant is selected is
// itself signed content — it is hashed as its index in the declared list — so
// the row states the payload shape the hash commits to.
const walkVariant = (
  path: string,
  payload: unknown,
  variantType: string,
  vocabulary: Vocabulary,
  out: Split,
  depth: number,
): void => {
  const inner = variantType.slice(1, -1);
  const elements = inner.length === 0 ? [] : inner.split(",");
  out.signed.push([path, variantType]);
  if (!Array.isArray(payload) || !hasOnlyArrayEntries(payload)) {
    if (elements.length === 0) {
      // Nothing under a `()` variant is read at all, so whatever the site put
      // there is decoration — known, not merely unproven.
      out.unsigned.push([path, payload]);
      return;
    }
    unclassified(out, path, payload);
    return;
  }
  elements.forEach((element, index) => {
    if (element.length === 0) {
      // `encodeValue` skips a falsy tuple element (`if (!subtype) return
      // subtype`) and hashes a constant in its place, so `(felt,)` covers only
      // its first element and whatever the payload put in the second is
      // decoration — the same one-character library detail that produced the
      // `()` variant hole.
      out.unsigned.push([`${path}[${index}]`, payload[index]]);
      return;
    }
    walkType(`${path}[${index}]`, payload[index], element, vocabulary, out, depth + 1);
  });
  payload.slice(elements.length).forEach((extra, index) => {
    out.unsigned.push([`${path}[${elements.length + index}]`, extra]);
  });
};

// `encodeValue` hashes `Object.entries(value)[0]` and nothing else, so every
// further variant a site packs into an enum value is decoration only. Enums
// exist on revision 1 alone — revision 0 falls through to `getHex(data)` — so
// without that revision the decoder cannot say what an enum field covers.
function walkEnum(
  path: string,
  value: unknown,
  contains: string | undefined,
  vocabulary: Vocabulary,
  out: Split,
  depth: number,
): void {
  const variants =
    vocabulary.revision === "1" && contains !== undefined
      ? structFields(vocabulary, contains)
      : null;
  const entries = isRecord(value) ? Object.entries(value) : [];
  const selected = entries[0];
  if (!variants || !selected) {
    unclassified(out, path, value);
    return;
  }
  const [variant, payload] = selected;
  const variantPath = join(path, variant);
  const variantType = variants.find((field) => field.name === variant)?.type ?? "";
  if (variantType.startsWith("(") && variantType.endsWith(")")) {
    walkVariant(variantPath, payload, variantType, vocabulary, out, depth);
  } else {
    // A variant the list never declares has no index and no payload type: the
    // encoder throws rather than hashing it.
    unclassified(out, variantPath, payload);
  }
  for (const [key, extra] of entries.slice(1)) {
    out.unsigned.push([join(path, key), extra]);
  }
}

// Decodes a top-level object against a declared struct. With no declaration
// nothing in the object is hashed, so every key is carried as unsigned — that
// is a certain answer, not an unclassified one.
const decode = (
  value: Record<string, unknown> | null,
  fields: readonly Snip12Field[] | null,
  vocabulary: Vocabulary,
): SignRequestSplit => {
  const out = emptySplit();
  if (!value) {
    return sealed(out);
  }
  if (fields) {
    walkStruct("", value, fields, vocabulary, out, 0);
    return sealed(out);
  }
  for (const [key, entry] of Object.entries(value)) {
    out.unsigned.push([join("", key), entry]);
  }
  return sealed(out);
};

// The primary type is covered by the type hash, so it is signed content, and it
// is reported as a row rather than as a section heading: it is site-chosen text,
// and a heading is where the card speaks in its own voice. A primary type the
// payload never declares hashes nothing at all, so it is reported unsigned.
const withPrimaryType = (
  split: SignRequestSplit,
  primaryType: string,
  hashed: boolean,
): SignRequestSplit => {
  if (primaryType.length === 0) {
    return split;
  }
  const row: SignRequestRow = [PRIMARY_TYPE_KEY, primaryType];
  return {
    signed: hashed ? [row, ...split.signed] : split.signed,
    unclassified: split.unclassified,
    unsigned: hashed ? split.unsigned : [row, ...split.unsigned],
  };
};

// Exactly the one domain struct the payload's revision hashes against — the
// revision 1 spelling for revision 1 and the legacy spelling for revision 0 —
// so a payload declaring both never shows rows from the one that is inert. With
// no identifiable revision nothing is hashed at all, and every domain key falls
// into the not-signed block. A domain `revision` key the struct does not
// declare lands there too: it selects the hash method rather than being hashed
// as a field, so it cannot carry a claim either way.
const domainFields = (
  vocabulary: Vocabulary,
  domainType: string | null,
): readonly Snip12Field[] | null => {
  const declared =
    vocabulary.types && domainType ? ownFieldValue(vocabulary.types, domainType) : undefined;
  return isFieldList(declared) ? declared : null;
};

/**
 * Splits an untrusted SNIP-12 envelope into the domain and message rows its own
 * type declarations put into the message hash and the rows they do not, and
 * reports whether every value could be placed with certainty.
 *
 * Trust boundary: the argument is a record read straight off an approval and is
 * fully untrusted. This never throws and never accepts a payload; an
 * `unclassified` split means the caller must not offer to sign, not that the
 * payload is invalid.
 */
export const decodeSignRequest = (record: Record<string, unknown>): SignRequestDecoding => {
  const resolved = snip12Vocabulary(record);
  const types = record["types"];
  const vocabulary: Vocabulary = {
    presets: resolved.presetFields,
    revision: resolved.revision,
    types: isRecord(types) ? types : null,
  };
  const primaryType = typeof record["primaryType"] === "string" ? record["primaryType"] : "";
  const domainValue = record["domain"];
  const messageValue = record["message"];
  // An undeclared primary type puts nothing at all into the hash — the hashing
  // boundary refuses such an envelope — so every message key falls into the
  // not-signed block rather than reading as message content.
  const messageFields = structFields(vocabulary, primaryType);
  const messageRecord = isRecord(messageValue) ? messageValue : null;
  const message = decode(messageRecord, messageFields, vocabulary);
  return {
    domain: decode(
      isRecord(domainValue) ? domainValue : null,
      domainFields(vocabulary, resolved.domainType),
      vocabulary,
    ),
    // The primary-type row belongs to the message block, so a payload carrying
    // no message object at all still renders no message block.
    message:
      messageRecord === null
        ? message
        : withPrimaryType(message, primaryType, messageFields !== null),
  };
};
