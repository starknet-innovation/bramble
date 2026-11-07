/**
 * Reads a reviewed workflow the way GitHub's runner does, or refuses to.
 *
 * A policy that compares decoded values is only as strict as the agreement
 * between its parser and GitHub's (YamlDotNet). `Bun.YAML` types values as
 * YAML 1.1, honours `%YAML` directives, and silently keeps the last of two
 * duplicate keys and resolves aliases and merge keys, so none of these can be
 * seen after parsing; GitHub does not resolve merge keys at all. This reader
 * runs, in order, and stops at the first group that fails:
 * - the raw-source character allowlist and final line feed
 *   (`workflow-source-characters.ts`), so no line break one parser sees and
 *   the other does not can hide content;
 * - a `yaml` parse under the YAML 1.2 core schema, duplicate keys refused and
 *   merge keys left literal (`STRICT_YAML`); any parse error fails;
 * - no anchor, alias, explicit tag or `<<` key anywhere;
 * - no directive, no scalar another YAML reader could type differently, and
 *   no plain or quoted scalar spanning lines nor folded block
 *   (`workflow-yaml-scalars.ts`).
 *
 * Only then is the document decoded. Anything the reader cannot read exactly
 * fails closed.
 */
import { type Document, isAlias, isScalar, parseDocument, visit } from "yaml";
import { sourceCharacterFailures } from "./workflow-source-characters";
import { STRICT_YAML, yamlDifferentialFailures } from "./workflow-yaml-scalars";

/** The outcome of a strict read: failures, or the decoded document when there are none. */
export type StrictWorkflow = {
  readonly failures: readonly string[];
  /** The decoded document; `undefined` whenever `failures` is not empty. */
  readonly value: unknown;
};

/** Anchors, aliases, explicit tags and `<<` merge keys anywhere in the document. */
const hasIndirection = (document: Document): boolean => {
  let found = false;
  visit(document, {
    Node(_key, node) {
      const explicit = (key: "anchor" | "tag"): boolean => key in node && node[key] !== undefined;
      if (isAlias(node) || explicit("anchor") || explicit("tag")) found = true;
    },
    Pair(_key, pair) {
      const key = isScalar(pair.key) ? pair.key.value : pair.key;
      if (key === "<<") found = true;
    },
  });
  return found;
};

const refused = (failures: readonly string[]): StrictWorkflow => ({ failures, value: undefined });

/**
 * Reads workflow `source` strictly (see the module comment). Every failure is
 * prefixed with `path`; `unreadable` is the failure reported when the text
 * does not parse as one YAML document with unique keys. Pure.
 */
export const readWorkflowStrictly = (
  source: string,
  path: string,
  unreadable: string,
): StrictWorkflow => {
  // Before any parsing: a character the parsers split lines on differently
  // could hide a step or a directive from everything below.
  const characters = sourceCharacterFailures(source, path);
  if (characters.length > 0) return refused(characters);
  const document = parseDocument(source, STRICT_YAML);
  if (document.errors.length > 0) return refused([unreadable]);
  if (hasIndirection(document)) {
    return refused([`${path} must not use YAML anchors, aliases, tags or merge keys`]);
  }
  const differentials = yamlDifferentialFailures(source, document, path);
  if (differentials.length > 0) return refused(differentials);
  return { failures: [], value: document.toJS() };
};
