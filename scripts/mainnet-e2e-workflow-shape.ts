/**
 * Shape matching for the Mainnet E2E workflow's parsed document.
 *
 * A reviewed shape states, for one job or step, every key it may have and the
 * exact decoded value of each. Matching is total over the decoded value: an
 * extra key, a missing key, a non-string `run`, or a list where a mapping was
 * reviewed all fail. Scripts are compared whole, line for line, so no command
 * can be added, dropped or wrapped; only trailing newlines (YAML chomping) are
 * ignored. A security-relevant script is stated as control blocks that
 * together are the whole script, so a change also names the control it hit.
 */

/** A reviewed script: decoded text that must match line for line. */
export class ScriptShape {
  /** The reviewed lines, joined with `\n` and without trailing newlines. */
  readonly text: string;

  /** Builds the shape from the script's lines, in order. */
  constructor(lines: readonly string[]) {
    this.text = lines.join("\n");
  }
}

/** The reviewed script made of `lines`, for use in a {@link Shape}. */
export const script = (lines: readonly string[]): ScriptShape => new ScriptShape(lines);

/** A reviewed decoded value: a scalar, a script, or a list or mapping of shapes. */
export type Shape =
  | string
  | number
  | boolean
  | null
  | ScriptShape
  | readonly Shape[]
  | { readonly [key: string]: Shape };

/** Consecutive whole lines of a `run` script, and the control they carry. */
export type Control = { readonly lines: readonly string[]; readonly failure: string };

/** One reviewed step: its exact keys and values, and, for a long script, its controls. */
export type StepShape = {
  /** Every key the step may have except `run` when `controls` is given. */
  readonly fields: { readonly [key: string]: Shape };
  /**
   * The decoded `run`, as blocks: after `set -euo pipefail`, the blocks'
   * lines in order must be the whole script.
   */
  readonly controls?: readonly Control[];
  /** Reported when the step is missing or differs from `fields`. */
  readonly failure: string;
};

type Node = Record<string, unknown>;

/** Whether a decoded value is a YAML mapping. */
export const isRecord = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The value as a mapping, or an empty one when it is anything else. */
export const record = (value: unknown): Node => (isRecord(value) ? value : {});

/**
 * Whether `value` is exactly `shape`: the same keys at every level, lists of
 * the same length in the same order, and equal scalars. Pure and total.
 */
export const matches = (shape: Shape, value: unknown): boolean => {
  if (shape instanceof ScriptShape) {
    return typeof value === "string" && value.replace(/\n+$/, "") === shape.text;
  }
  if (Array.isArray(shape)) {
    return (
      Array.isArray(value) &&
      value.length === shape.length &&
      shape.every((item: Shape, index) => matches(item, value[index]))
    );
  }
  if (typeof shape === "object" && shape !== null) {
    const entries = Object.entries(shape as { readonly [key: string]: Shape });
    return (
      isRecord(value) &&
      Object.keys(value).length === entries.length &&
      entries.every(([key, item]) => Object.hasOwn(value, key) && matches(item, value[key]))
    );
  }
  return shape === value;
};

/**
 * `node` without a `continue-on-error: false`, which GitHub treats as absent.
 * Any other `continue-on-error` value is kept, so it fails the shape match.
 */
export const withoutDefaults = (node: Node): Node => {
  const { "continue-on-error": tolerate, ...rest } = node;
  return tolerate === false ? rest : node;
};

const containsAt = (lines: readonly string[], block: readonly string[], at: number): boolean =>
  block.every((line, offset) => lines[at + offset] === line);

/**
 * Failures for each control block missing from `run`, searching in order: a
 * block counts only when found after the previous block. A script that is not
 * a string, or does not open with `set -euo pipefail`, fails every block.
 * Whether the blocks are the whole script is checked by the caller.
 */
export const controlFailures = (run: unknown, controls: readonly Control[]): string[] => {
  const lines = typeof run === "string" ? run.replace(/\n+$/, "").split("\n") : [];
  if (lines[0] !== "set -euo pipefail") return controls.map(({ failure }) => failure);
  const failures: string[] = [];
  let from = 1;
  for (const { lines: block, failure } of controls) {
    let at = from;
    while (at < lines.length && !containsAt(lines, block, at)) at += 1;
    if (at >= lines.length) {
      failures.push(failure);
    } else {
      from = at + block.length;
    }
  }
  return failures;
};

/** A step's identity for ordering: its `id`, else its `name`, else its action without the ref. */
export const stepIdentity = (step: unknown): string => {
  const node = record(step);
  for (const key of ["id", "name"]) {
    if (typeof node[key] === "string") return `${key}:${node[key]}`;
  }
  return typeof node["uses"] === "string" ? `uses:${node["uses"].split("@")[0]}` : "?";
};

const stepShapeFailures = (step: Node, shape: StepShape): string[] => {
  const node = withoutDefaults(step);
  const { run, ...rest } = node;
  const fields = shape.controls === undefined ? node : rest;
  const failures = matches(shape.fields, fields) ? [] : [shape.failure];
  if (shape.controls !== undefined) {
    failures.push(...controlFailures(run, shape.controls));
    const whole = ["set -euo pipefail", ...shape.controls.flatMap(({ lines }) => lines)];
    if (!matches(script(whole), run)) failures.push(shape.failure);
  }
  return failures;
};

/**
 * Failures for a job's `steps` against its reviewed shapes. The steps must be
 * a list whose identities equal the reviewed ones, in order (`order` is
 * reported otherwise); each reviewed step is then matched against the first
 * unused step with its identity, and a reviewed step with no such step
 * reports its own failure.
 */
export const stepsFailures = (
  steps: unknown,
  shapes: readonly StepShape[],
  order: string,
): string[] => {
  if (!Array.isArray(steps)) return [order, ...shapes.map(({ failure }) => failure)];
  const failures: string[] = [];
  const identities = steps.map(stepIdentity);
  const reviewed = shapes.map(({ fields }) => stepIdentity(fields));
  if (!matches(reviewed, identities)) failures.push(order);
  const used = new Set<number>();
  for (const [index, shape] of shapes.entries()) {
    const at = identities.findIndex((identity, i) => identity === reviewed[index] && !used.has(i));
    if (at < 0) {
      failures.push(shape.failure);
      continue;
    }
    used.add(at);
    failures.push(...stepShapeFailures(record(steps[at]), shape));
  }
  return failures;
};
