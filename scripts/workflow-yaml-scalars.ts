/**
 * Guards against YAML parser differentials in a reviewed workflow.
 *
 * A policy compares decoded values, so it is only as strict as the agreement
 * between its parser and GitHub's. YAML versions and schemas disagree on
 * plain scalars: under YAML 1.1, `0170` is octal 120, `yes`/`on` are
 * booleans and `1_20` is 120; under the 1.2 core schema `0x78`, `0o170`,
 * `+120` and `1.2e2` are all 120 and `True` is true. This module refuses
 * every document directive (`%YAML`, `%TAG` or any other `%` line, found by
 * the lexer, so a byte-order mark, comments or CRLF cannot hide one), and
 * then requires every scalar to be written in the one form all readers type
 * the same way:
 * - a number only as a plain decimal integer of at most 15 digits;
 * - a boolean only as plain `true` or `false`;
 * - no plain string that another YAML reader would read as a number or
 *   boolean (YAML 1.1 words such as `yes`/`off`, underscored, binary or
 *   sexagesimal numbers), except the root `on:` key GitHub defines.
 * Anything else must be quoted, which every reader decodes as a string.
 * Plain and quoted scalars must fit on one line, and multi-line text must be
 * a literal block headed exactly `|` or `|-`: readers disagree on folded
 * blocks and on escaped line breaks and empty lines inside quoted scalars.
 */
import { type Document, Parser, type Scalar, visit } from "yaml";

/** Parse options that pin the 1.2 core schema; a `%YAML` line cannot change the schema. */
export const STRICT_YAML = {
  merge: false,
  schema: "core",
  uniqueKeys: true,
  version: "1.2",
} as const;

// At most 15 digits, so every accepted number is a safe integer that any
// reader holds exactly.
const DECIMAL = /^(?:0|[1-9][0-9]{0,14})$/;
const YAML_11_BOOLEAN = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF)$/;
// YAML 1.1 int and float forms the core schema leaves as strings.
const YAML_11_NUMBER =
  /^[-+]?(?:0b[01_]+|0x[0-9a-fA-F_]+|[0-9][0-9_]*(?::[0-5]?[0-9])*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.(?:inf|Inf|INF|nan|NaN|NAN))$/;

/** Whether `source` holds any YAML directive line, read by the lexer. */
export const hasDirective = (source: string): boolean =>
  [...new Parser().parse(source)].some((token) => token.type === "directive");

// The scalar's own text in the source; a node with no range reads as empty,
// which no rule accepts for a number or boolean.
const sourceOf = (node: Scalar, source: string): string =>
  node.range ? source.slice(node.range[0], node.range[1]) : "";

// Multi-line text only as a literal block with the default or strip chomp
// and no indentation indicator: parsers disagree on folding, escaped line
// breaks in quoted scalars, and empty lines in multi-line flow scalars.
const lineFailure = (node: Scalar, text: string): string | null => {
  if (node.type === "BLOCK_FOLDED") return "must not use folded (>) block scalars";
  if (node.type === "BLOCK_LITERAL") {
    const [header] = text.split(/\r?\n/);
    return header === "|" || header === "|-" ? null : `must not use the block header ${header}`;
  }
  return text.includes("\n") ? "must keep every plain or quoted scalar on one line" : null;
};

const scalarFailure = (node: Scalar, text: string, rootKey: boolean): string | null => {
  const multiLine = lineFailure(node, text);
  if (multiLine !== null) return multiLine;
  const plain = node.type === "PLAIN";
  if (typeof node.value === "number" && !(plain && DECIMAL.test(text))) {
    return "must write every number as a plain decimal integer";
  }
  if (typeof node.value === "boolean" && !(plain && (text === "true" || text === "false"))) {
    return "must write every boolean as plain true or false";
  }
  if (
    typeof node.value === "string" &&
    plain &&
    (YAML_11_BOOLEAN.test(text) || YAML_11_NUMBER.test(text)) &&
    !(rootKey && text === "on")
  ) {
    return `must quote ${text}, which another YAML reader types as a number or boolean`;
  }
  return null;
};

/**
 * Parser-differential violations in a workflow `document` parsed from
 * `source` with {@link STRICT_YAML}, each prefixed with `path`. Pure. A
 * directive is reported alone, since the document's typing is then in doubt.
 */
export const yamlDifferentialFailures = (
  source: string,
  document: Document,
  path: string,
): string[] => {
  const tags = Object.keys(document.directives?.tags ?? {});
  if (hasDirective(source) || document.directives?.yaml.explicit || tags.length !== 1) {
    return [`${path} must not use YAML directives (%YAML, %TAG or any % line)`];
  }
  const failures = new Set<string>();
  visit(document, {
    Scalar(key, node, ancestors) {
      const rootKey = key === "key" && ancestors.length === 3;
      const failure = scalarFailure(node, sourceOf(node, source), rootKey);
      if (failure !== null) failures.add(`${path} ${failure}`);
    },
  });
  return [...failures];
};
