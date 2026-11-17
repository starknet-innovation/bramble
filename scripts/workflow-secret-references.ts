/**
 * Decoded-string scan for GitHub `secrets` context references in a parsed
 * workflow document.
 *
 * Shared by the reviewed workflow policies (Ledger E2E, Mainnet E2E) so each
 * reads every key and string value of the decoded document the same way,
 * rather than matching the workflow's spelling. A reference is the `secrets`
 * context used as a root anywhere inside a `${{ }}` expression, or anywhere in
 * an `if:` value (which GitHub evaluates as an expression without the
 * wrapper): `secrets.X`, `secrets['X']`, `secrets["X"]`, `secrets[expr]`,
 * `toJSON(secrets)`, with any whitespace or letter case. `steps.secrets` and
 * `check-secrets` are properties or identifiers, not the context.
 *
 * The scan errs toward reporting: string literals are not tracked, so a
 * root-position `secrets` inside one (`'secrets.X'`) still counts, and an
 * unterminated expression runs to the end of its string. Every occurrence is
 * reported, so a caller can count them.
 */

/** One step along a path into the decoded document: a mapping key or a list index. */
export type DocumentPathPart = string | number;

/** A key or string value of the decoded document, with where it sits. */
export type DocumentString = {
  /** Path from the document root; for a key, the path ends with the key itself. */
  readonly path: readonly DocumentPathPart[];
  /** Whether the text is a mapping key rather than a value. */
  readonly key: boolean;
  /** The decoded text. */
  readonly text: string;
};

/** One `secrets` context reference and where it sits in the decoded document. */
export type SecretReference = DocumentString & {
  /** The upper-cased secret name, or `*` for the whole context or a computed index. */
  readonly secret: string;
};

/** Any secret name, used when the reference reads the whole context or a computed index. */
export const ANY_SECRET = "*";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every mapping key and string value in a decoded YAML document, depth first.
 * Numbers, booleans and nulls cannot carry an expression and are skipped.
 */
export const documentStrings = (
  node: unknown,
  path: readonly DocumentPathPart[] = [],
  found: DocumentString[] = [],
): DocumentString[] => {
  if (typeof node === "string") {
    found.push({ path, key: false, text: node });
  } else if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) documentStrings(item, [...path, index], found);
  } else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      found.push({ path: [...path, key], key: true, text: key });
      documentStrings(value, [...path, key], found);
    }
  }
  return found;
};

// The end of the expression opened at `start`, skipping `}}` inside a
// single-quoted literal (GitHub escapes a quote by doubling it). An
// unterminated expression runs to the end of the text.
const expressionEnd = (text: string, start: number): number => {
  let quoted = false;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "'") quoted = !quoted;
    else if (!quoted && text.startsWith("}}", index)) return index;
  }
  return text.length;
};

/**
 * The bodies of every `${{ … }}` expression in `text`. A `}}` inside a quoted
 * literal does not close the expression, and an unterminated one runs to the
 * end of the text, so nothing after an opener escapes the scan.
 */
export const expressionBodies = (text: string): string[] => {
  const bodies: string[] = [];
  let open = text.indexOf("${{");
  while (open >= 0) {
    const end = expressionEnd(text, open + 3);
    bodies.push(text.slice(open + 3, end));
    open = text.indexOf("${{", end);
  }
  return bodies;
};

const NAME = /^\s*([A-Za-z_][A-Za-z0-9_-]*)/;
const INDEX = /^\s*\[\s*(['"])([A-Za-z_][A-Za-z0-9_-]*)\1\s*\]/;

// The secret a root `secrets` reference at `end` names, or `*` when it reads
// the whole context or indexes it with anything but a literal name.
const referencedName = (body: string, end: number): string => {
  const rest = body.slice(end);
  const dot = /^\s*\./.exec(rest);
  const named = dot === null ? INDEX.exec(rest)?.[2] : NAME.exec(rest.slice(dot[0].length))?.[1];
  return named === undefined ? ANY_SECRET : named.toUpperCase();
};

// Whether the `secrets` word at `start` is the context root rather than a
// property (`steps.secrets`, `steps . secrets`) or part of an identifier.
const isRoot = (body: string, start: number): boolean => {
  if (/[A-Za-z0-9_-]/.test(body[start - 1] ?? "")) return false;
  const before = body.slice(0, start).trimEnd();
  return !before.endsWith(".");
};

/**
 * The secret names referenced by one expression body: upper-cased names, or
 * {@link ANY_SECRET} for `toJSON(secrets)`, a bare `secrets` or a computed index.
 */
export const secretNames = (body: string): string[] =>
  [...body.matchAll(/secrets\b/gi)]
    .filter((match) => isRoot(body, match.index))
    .map((match) => referencedName(body, match.index + match[0].length));

const isCondition = (entry: DocumentString): boolean =>
  !entry.key && entry.path[entry.path.length - 1] === "if";

/**
 * Every `secrets` context reference in a decoded workflow document: in any key
 * or string value, inside `${{ }}`, or anywhere in an `if:` value.
 */
export const secretReferences = (document: unknown): SecretReference[] =>
  documentStrings(document).flatMap((entry) => {
    // An `if:` is read whole: it is an expression with or without `${{ }}`.
    const bodies = isCondition(entry) ? [entry.text] : expressionBodies(entry.text);
    return bodies.flatMap(secretNames).map((secret) => ({ ...entry, secret }));
  });
