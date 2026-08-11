/**
 * The row vocabulary the sign approval card's decode is built from: what a
 * decoded row is, the two lists a payload's values are split into, and the
 * lookups that decide which list a value belongs in.
 *
 * It lives beside `./sign-request-decode` rather than inside it so the walk — a
 * mutually recursive set of functions that has to stay readable in one screen —
 * is not sharing a file with the bookkeeping it uses. Nothing here walks
 * anything; everything here is a definition or a single lookup.
 *
 * Trust boundary: every argument is untrusted dapp input of any shape. Nothing
 * here throws, and nothing here decides whether a payload may be signed —
 * `isTypedDataShape` in `src/starknet/typed-data.ts` is that gate.
 */
import { isOwnDataProperty, isRecord, JSON_BUDGETS } from "../shared/json";
import type { Snip12Field, Snip12Revision } from "../starknet/snip12-vocabulary";
import { signNameText } from "./sign-request-text";

/**
 * A decoded row: the dotted path a value sits at, and the value itself.
 */
export type SignRequestRow = readonly [string, unknown];

/**
 * One object's values split by whether the payload's own type declarations put
 * them into the message hash. `unclassified` is set when some value's coverage
 * could not be established at all; those values are carried in `unsigned`, the
 * conservative side, and callers must not offer an approve affordance for a
 * decoding that reports it.
 */
export type SignRequestSplit = {
  readonly signed: readonly SignRequestRow[];
  readonly unclassified: boolean;
  readonly unsigned: readonly SignRequestRow[];
};

/**
 * The row key the primary type is reported under. The type hash covers it, so it
 * belongs in the signed block — but it is site-chosen text, so it is a row value
 * rather than a section heading a user might read as the wallet's own words. The
 * angle brackets are outside both the SNIP-12 name grammar and the sanitized
 * spelling `signNameText` produces, so no key decoded from a payload can spell
 * this one.
 */
export const PRIMARY_TYPE_KEY = "⟨primary type⟩";

/**
 * The accumulator the walk fills, narrowed to the readonly `SignRequestSplit` by
 * {@link sealed} on the way out so callers cannot append to a decoding after the
 * fact. `unresolved` records the path of every value the walk could not place,
 * which is what `unclassified` reports; keeping it a list rather than a flag
 * means the walk only ever appends, never rewrites what a caller handed it.
 */
export type Split = {
  readonly signed: SignRequestRow[];
  readonly unresolved: string[];
  readonly unsigned: SignRequestRow[];
};

/**
 * A fresh, empty accumulator. Never share one between two decodes.
 */
export const emptySplit = (): Split => ({ signed: [], unresolved: [], unsigned: [] });

/**
 * Freezes an accumulator into the readonly split a caller may hold, collapsing
 * the unresolved-path list into the single `unclassified` verdict.
 */
export const sealed = (split: Split): SignRequestSplit => ({
  signed: split.signed,
  unclassified: split.unresolved.length > 0,
  unsigned: split.unsigned,
});

/**
 * Records a value whose coverage the decoder cannot establish: carried as
 * not-signed, which is the side that cannot mislead, and flagged so the card
 * refuses to offer signing rather than presenting a view it cannot vouch for.
 */
export const unclassified = (out: Split, path: string, value: unknown): void => {
  out.unsigned.push([path, value]);
  out.unresolved.push(path);
};

/**
 * The payload's own declarations plus the vocabulary its revision resolves.
 * They travel together because both are revision-dependent: a preset only
 * exists on the revision that declares it (resolving `u256` into `low`/`high`
 * under revision 0 would show two rows the hash never covered), and only
 * revision 1 has enums at all.
 */
export type Vocabulary = {
  readonly presets: ReadonlyMap<string, readonly Snip12Field[]>;
  readonly revision: Snip12Revision | null;
  readonly types: Record<string, unknown> | null;
};

/**
 * The deepest the walk descends before reporting a value unplaceable.
 *
 * The walk must be able to classify every payload the hashing boundary accepts,
 * so its cap is derived from that boundary's own budget rather than being a
 * second literal that could drift below it. The walk enters at the `domain` /
 * `message` object, which already sits one level inside the envelope the budget
 * measures, so a value the budget admits is reached at a strictly smaller walk
 * depth than this cap. The cap therefore only bounds work for payloads that were
 * already refused upstream — and those are reported unclassified rather than
 * shown as signed.
 */
export const MAX_DEPTH = JSON_BUDGETS.typedData.maxDepth;

/**
 * Checks that an untrusted `types` entry is a SNIP-12 field list. Deliberately
 * looser than the hashing gate's own reader: the card renders payloads that gate
 * refuses, and a field list it can read is a field list it can split against.
 */
export const isFieldList = (value: unknown): value is readonly Snip12Field[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      isRecord(entry) && typeof entry["name"] === "string" && typeof entry["type"] === "string",
  );

/**
 * Appends one path segment to a row path.
 *
 * Every segment the card prints goes through the SNIP-12 name grammar, not only
 * the declared ones the hashing gate already vetted: an undeclared message key,
 * an enum variant a value invented, and every name inside a payload the gate
 * refused are all attacker-chosen, and a bidi override or a homoglyph among them
 * would read as a field the payload never had.
 */
export const join = (path: string, part: string): string => {
  const segment = signNameText(part);
  return path ? `${path}.${segment}` : segment;
};

/**
 * Reads a declared field out of an untrusted record as an own, enumerable data
 * property, or `undefined` when the record does not carry one.
 *
 * The pinned library reads `data[field.name]`, which walks the prototype chain —
 * a field named `constructor` resolves to `Object.prototype.constructor` out of
 * an empty message. `isTypedDataShape` refuses such a payload, but this card
 * renders payloads it refuses, so the value the card describes is never one only
 * the prototype supplied.
 */
export const ownFieldValue = (record: Record<string, unknown>, name: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(record, name);
  return isOwnDataProperty(descriptor) ? descriptor.value : undefined;
};

/**
 * The field list a type name resolves to, in the order the encoder resolves it:
 * a declaration first, then the preset of the same name that the payload's
 * revision knows about. Null when the name is a leaf type or resolves to
 * nothing at all.
 */
export const structFields = (
  vocabulary: Vocabulary,
  name: string,
): readonly Snip12Field[] | null => {
  const declared = vocabulary.types ? ownFieldValue(vocabulary.types, name) : undefined;
  return isFieldList(declared) ? declared : (vocabulary.presets.get(name) ?? null);
};
