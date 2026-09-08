/**
 * Text primitives shared by the repository's workflow policy rules.
 *
 * These live apart from the rules that use them so a new rule reuses the same
 * extraction and the same failure semantics rather than re-deriving them. Every
 * helper is pure and total, which is what lets a policy test mutate one control
 * at a time without touching the filesystem.
 */
import { escapeRegExp } from "./regexp";
import { WORKFLOW_DIR } from "./workflow-inventory";

/**
 * The repository-relative path of a workflow, given its file name. Used so a
 * failure names the file a contributor must open.
 */
export const workflowPath = (name: string): string => `${WORKFLOW_DIR}/${name}`;

/**
 * The text of one job within a workflow source, or `""` when the workflow has
 * no such job. Fails safe in the direction of an empty body: a rule that
 * requires text inside a job it cannot find reports a failure rather than
 * silently passing. A sentinel key bounds the search so the final job in a file
 * is matched like any other.
 */
export const jobBody = (workflow: string, job: string): string => {
  const bounded = `${workflow}\n  __workflow_policy_end__:\n`;
  const escaped = escapeRegExp(job);
  return (
    bounded.match(new RegExp(`^  ${escaped}:\\n[\\s\\S]*?(?=^  [a-zA-Z0-9_-]+:\\n)`, "m"))?.[0] ??
    ""
  );
};

/**
 * Appends `failure` when `source` does not contain `expected`. Mutates the
 * supplied list so a rule can accumulate every violation it finds instead of
 * stopping at the first.
 */
export const requireText = (
  failures: string[],
  source: string,
  expected: string,
  failure: string,
): void => {
  if (!source.includes(expected)) {
    failures.push(failure);
  }
};

/**
 * Appends `failure` when `source` contains `forbidden`. The inverse of
 * {@link requireText}, for controls stated as prohibitions.
 */
export const forbidText = (
  failures: string[],
  source: string,
  forbidden: string,
  failure: string,
): void => {
  if (source.includes(forbidden)) {
    failures.push(failure);
  }
};
