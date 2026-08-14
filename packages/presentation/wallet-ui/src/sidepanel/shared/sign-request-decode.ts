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
 * (`isTypedDataShape` in `@mc-wallet/starknet/typed-data` is that gate), and the
 * decoder renders payloads that gate refuses.
 */
import { hasOnlyArrayEntries, isRecord } from "@mc-wallet/core/json";
import { snip12MerkleLayout, snip12MerkleRoot } from "@mc-wallet/starknet/snip12-merkle";
import { snip12Scalar } from "@mc-wallet/starknet/snip12-scalars";
import { type Snip12Field, snip12Vocabulary } from "@mc-wallet/starknet/snip12-vocabulary";
import { isTypedDataShape } from "@mc-wallet/starknet/typed-data";
import {
  emptySplit,
  isFieldList,
  join,
  MAX_DEPTH,
  merkleLeafKey,
  merkleRootKey,
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
  parent: string,
  vocabulary: Vocabulary,
  out: Split,
  depth: number,
): void {
  if (field.type === "enum") {
    walkEnum(path, value, field.contains, vocabulary, out, depth);
    return;
  }
  if (field.type === "merkletree" && field.contains !== undefined) {
    walkMerkle(path, value, field, parent, vocabulary, out, depth);
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
  type: string,
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
      type,
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

// Identity key for one decoded leaf, standing for everything the card would
// print for it. It is built from the decoded rows rather than from the leaf
// object, so two leaves the encoder hashes identically — declared fields in
// either written order — are treated as the interchangeable leaves they are.
const leafOrder = (split: Split): string => {
  try {
    return JSON.stringify([split.signed, split.unsigned]) ?? "";
  } catch {
    return "";
  }
};

// Every row a leaf decoded to is addressed under the placeholder group the leaf
// was walked with, so re-addressing it under its real group is a prefix swap on
// keys this module built itself.
const regrouped = (rows: readonly SignRequestRow[], from: string, to: string): SignRequestRow[] =>
  rows.map(
    ([key, value]): SignRequestRow => [
      key.startsWith(from) ? `${to}${key.slice(from.length)}` : key,
      value,
    ],
  );

// A merkle root commits to the leaf multiset *and* to how the leaves are paired.
// `MerkleTree.hash` sorts its two operands, so exchanging the two children of a
// node is invisible to the root; `MerkleTree.build` pairs strictly by index and
// pads a trailing odd leaf against `0x0`, so moving a leaf into a different pair
// is not. Ordering all the leaves together would therefore print one receipt for
// trees the account signs different roots for, and an ordinal in a row key would
// state a position the root does not cover — so `snip12MerkleLayout` mirrors the
// library's pairing, leaves are addressed by the group they are hashed in, and
// the root itself is reported as the field's own signed value.
const walkMerkle = (
  path: string,
  value: unknown,
  field: Snip12Field,
  parent: string,
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
  const placeholder = merkleLeafKey(path, "");
  const decoded = value.map((entry) => {
    const split = emptySplit();
    walkType(placeholder, entry, field.contains ?? "", vocabulary, split, depth + 1);
    return split;
  });
  const root =
    vocabulary.hashable && vocabulary.types && vocabulary.revision !== null
      ? snip12MerkleRoot(vocabulary.types, parent, field.name, value, vocabulary.revision)
      : null;
  if (root !== null) {
    out.signed.push([merkleRootKey(path), root]);
  }
  for (const placement of snip12MerkleLayout(decoded.map(leafOrder))) {
    const split = decoded[placement.index];
    if (!split) {
      continue;
    }
    const group = merkleLeafKey(path, placement.group);
    out.signed.push(...regrouped(split.signed, placeholder, group));
    out.unsigned.push(...regrouped(split.unsigned, placeholder, group));
    out.unresolved.push(
      ...split.unresolved.map((key) =>
        key.startsWith(placeholder) ? `${group}${key.slice(placeholder.length)}` : key,
      ),
    );
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
    walkStruct(path, value, fields, type, vocabulary, out, depth);
    return;
  }
  // A leaf type hashes the value itself — but only a value the declared type
  // can mean is one it hashes as what it reads as. An object or array parked
  // under `felt` is unhashable decoration; prose under `u128` and the string
  // `"false"` under `felt` hash as large numbers that a verbatim row would
  // never say. `snip12Scalar` is the same reading the hashing gate accepts by,
  // and it carries the canonical felt the row must print beside the value.
  if (typeof value === "object" && value !== null) {
    unclassified(out, path, value);
    return;
  }
  if (value === undefined || value === null) {
    // A declared field the site omitted: unhashable, and shown as an em dash so
    // the omission itself stays visible rather than the field disappearing.
    out.signed.push([path, value]);
    return;
  }
  const resolved =
    vocabulary.revision === null ? null : snip12Scalar(value, type, vocabulary.revision);
  if (resolved === null) {
    unclassified(out, path, value);
    return;
  }
  out.signed.push([path, resolved]);
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
  type: string,
  vocabulary: Vocabulary,
): SignRequestSplit => {
  const out = emptySplit();
  if (!value) {
    return sealed(out);
  }
  if (fields) {
    walkStruct("", value, fields, type, vocabulary, out, 0);
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
    // Asked once, for the whole envelope: a merkle field's root is read back
    // from the pinned library, and the library may only be handed a payload that
    // gate has already bounded. A refused payload simply shows no root.
    hashable: isTypedDataShape(record),
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
  const message = decode(messageRecord, messageFields, primaryType, vocabulary);
  return {
    domain: decode(
      isRecord(domainValue) ? domainValue : null,
      domainFields(vocabulary, resolved.domainType),
      resolved.domainType ?? "",
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
