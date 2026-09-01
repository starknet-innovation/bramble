/**
 * The repository's GitHub Actions inventory and the action-pinning rule.
 *
 * Both are here so no gate keeps its own list of workflows or its own idea of
 * what a pinned action looks like. The inventory is read from the directory,
 * never from a hand-maintained table: a workflow that is added but forgotten in
 * a constant is a workflow that runs with none of the repository's trust rules
 * applied to it. GitHub executes `.yml` and `.yaml` identically, so both are
 * inventoried and any other file in the directory is an error rather than a
 * silent skip.
 *
 * The extraction is deliberately textual — these are reviewable policy
 * statements about workflow source, not general YAML shape — and therefore
 * fails closed: a `uses:` key whose value cannot be resolved to exactly one
 * token on the same line is reported as an unpinned reference instead of being
 * dropped. A gate that cannot read a reference must not conclude it is safe.
 * The same rule means a `uses:` written in a trailing comment or inside a
 * script block is reported too; a whole-line comment is skipped, so prose about
 * actions belongs on its own line (or without the colon). Erring toward a
 * failure a contributor can reword is the cheap side of this trade.
 */
import { readdir, readFile } from "node:fs/promises";

/**
 * Directory holding every repository workflow. The single source for "which
 * workflows exist"; callers enumerate it rather than naming files.
 */
export const WORKFLOW_DIR = ".github/workflows";

/**
 * Every workflow in {@link WORKFLOW_DIR}, keyed by file name (`ci.yml`). The key
 * space is whatever is on disk, so a new workflow enters every gate that
 * iterates this map without any list being updated.
 */
export type WorkflowSources = Readonly<Record<string, string>>;

/**
 * One `uses:` reference and the 1-based line it was found on, so a gate can
 * report the exact line a contributor must fix.
 */
export type ActionReference = {
  readonly line: number;
  readonly reference: string;
};

// Both extensions GitHub runs. A `.yaml` workflow once escaped the inventory
// entirely — and with it the whole security policy — because only `.yml` was
// read here.
const WORKFLOW_FILE_PATTERN = /\.ya?ml$/;
// Every spelling of the `uses` mapping key that GitHub accepts and executes:
// the block step (`- uses: x`), the bare key of a step whose first key is
// `name:` and of a job-level reusable-workflow call, the flow mapping
// (`- {uses: x}`), the flow sequence (`steps: [{uses: x}]`), and the quoted key
// (`- "uses": x`). Anchoring on the list-item dash — as this gate once did —
// exempted every reference that is not written in the first form. The leading
// delimiter keeps unrelated keys that merely end in "uses" (`statuses:`) out.
const USES_KEY_PATTERN = /(?:^|[-{[,\s])["']?uses["']?[ \t]*:/g;
// A reference runs to the first character that closes the value: whitespace
// (a trailing `# v1.2.3` comment) or a flow-collection delimiter.
const REFERENCE_VALUE_PATTERN = /^[ \t]*([^\s,}\]]*)/;
const SURROUNDING_QUOTE_PATTERN = /^["']|["']$/g;
// `owner/repo@<40-hex commit>`; a tag or branch ref is mutable, so a compromised
// upstream can change what runs under a reference that was reviewed once.
const PINNED_ACTION_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/;
// A reusable workflow stored in this repository: it has no external publisher to
// pin, travels with the commit that calls it, and is covered by review.
const LOCAL_WORKFLOW_PATTERN = /^\.\/\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/;

const referenceValue = (rest: string): string =>
  (rest.match(REFERENCE_VALUE_PATTERN)?.[1] ?? "").replace(SURROUNDING_QUOTE_PATTERN, "");

/**
 * Every `uses:` reference in a workflow, in file order. Total: a source with no
 * references yields an empty list, and no input throws. A full-line comment is
 * not source, so it is skipped; a `uses:` whose value is not on the same line
 * yields the raw line text, which no pin rule accepts, so an unreadable
 * reference fails the gate rather than escaping it.
 */
export const actionReferences = (source: string): readonly ActionReference[] => {
  const found: ActionReference[] = [];
  for (const [index, text] of source.split("\n").entries()) {
    if (text.trimStart().startsWith("#")) {
      continue;
    }
    for (const match of text.matchAll(USES_KEY_PATTERN)) {
      const value = referenceValue(text.slice(match.index + match[0].length));
      found.push({ line: index + 1, reference: value === "" ? text.trim() : value });
    }
  }
  return found;
};

/**
 * Whether a `uses:` reference is one this repository allows to execute: an
 * external action pinned to a commit SHA, or a local reusable workflow. Anything
 * else — a tag, a branch, a bare action name, or a reference the extractor could
 * not resolve — is rejected.
 */
export const isPinnedActionReference = (reference: string): boolean =>
  PINNED_ACTION_PATTERN.test(reference) || LOCAL_WORKFLOW_PATTERN.test(reference);

/**
 * The 1-based line of the first pinned reference to an action whose name starts
 * with `prefix`, or 0 when the workflow has no such pinned reference. Lets an
 * ordering gate locate a required step without re-deriving the pin grammar.
 */
export const pinnedActionLine = (source: string, prefix: string): number =>
  actionReferences(source).find(
    ({ reference }) => reference.startsWith(prefix) && isPinnedActionReference(reference),
  )?.line ?? 0;

/**
 * Reads every workflow from {@link WORKFLOW_DIR}, or from `directory` when a
 * test supplies one. Throws when the directory cannot be read, when it holds no
 * workflow, or when it holds a file that is not a `.yml`/`.yaml` workflow: a
 * gate that silently inspected zero workflows — or skipped one — would report
 * success while checking nothing.
 */
export const readWorkflowSources = async (
  directory: string = WORKFLOW_DIR,
): Promise<WorkflowSources> => {
  const names = (await readdir(directory)).sort();
  const foreign = names.filter((name) => !WORKFLOW_FILE_PATTERN.test(name));
  if (foreign.length > 0) {
    throw new Error(
      `${directory} holds non-workflow files (${foreign.join(", ")}); every file there must be policed`,
    );
  }
  if (names.length === 0) {
    throw new Error(`No workflows found in ${directory}; the workflow gates would check nothing`);
  }
  const entries = await Promise.all(
    names.map(async (name) => [name, await readFile(`${directory}/${name}`, "utf8")] as const),
  );
  return Object.fromEntries(entries);
};
