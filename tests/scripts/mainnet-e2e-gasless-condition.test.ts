/**
 * The gasless step's `if:` is compared as a whole value on the step whose id
 * is `gasless`, not found as a substring anywhere in the job. Each mutation
 * below keeps the expected text somewhere in the file and must still fail.
 */
import { describe, expect, test } from "bun:test";
import {
  GASLESS_CONDITION,
  gaslessCondition,
  mainnetE2eWorkflowFailures,
} from "../../scripts/mainnet-e2e-workflow-policy";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { jobBody } from "../../scripts/workflow-policy-text";

const WORKFLOW = "mainnet-e2e.yml";
const FAILURE = "mainnet execution must run the gasless send only after the secrets step passed";
const IF_LINE = `        if: ${GASLESS_CONDITION}\n`;
const GASLESS_HEAD = "      - name: Gasless mainnet\n        id: gasless\n";

const workflow = async (): Promise<string> => (await readWorkflowSources())[WORKFLOW] ?? "";

const mutated = (source: string, search: string, replacement: string): string => {
  expect(source).toContain(search);
  return source.replace(search, replacement);
};

const gaslessStep = (source: string): string => {
  const at = source.indexOf(GASLESS_HEAD);
  expect(at).toBeGreaterThan(0);
  return source.slice(at, source.indexOf("      - name: Require the gasless send\n", at));
};

describe("mainnet E2E gasless step condition", () => {
  test("the repository workflow carries exactly the reviewed condition", async () => {
    const source = await workflow();
    expect(gaslessCondition(jobBody(source, "execute"))).toBe(GASLESS_CONDITION);
    expect(mainnetE2eWorkflowFailures(source)).not.toContain(FAILURE);
  });

  test("rejects a weakened, reworded or relocated condition", async () => {
    const source = await workflow();
    const expression = "$" + "{{";
    const mutations: ReadonlyArray<readonly [string, string, string]> = [
      ["appended || always()", IF_LINE, `        if: ${GASLESS_CONDITION} || always()\n`],
      ["appended || true", IF_LINE, `        if: ${GASLESS_CONDITION} || true\n`],
      ["always() prefix", IF_LINE, `        if: always() && ${GASLESS_CONDITION}\n`],
      ["double-quoted", IF_LINE, `        if: "${GASLESS_CONDITION}"\n`],
      ["expression wrapper", IF_LINE, `        if: ${expression} ${GASLESS_CONDITION} }}\n`],
      ["trailing comment", IF_LINE, `        if: ${GASLESS_CONDITION} # reviewed\n`],
      ["block scalar", IF_LINE, `        if: >-\n          ${GASLESS_CONDITION}\n`],
      ["only in a comment", IF_LINE, `        # if: ${GASLESS_CONDITION}\n        if: always()\n`],
      ["no if", IF_LINE, ""],
      [
        "on a different step",
        `${GASLESS_HEAD}${IF_LINE}`,
        `      - name: Decoy\n${IF_LINE}        run: "true"\n${GASLESS_HEAD}        if: always()\n`,
      ],
      ["two if lines", IF_LINE, `${IF_LINE}        if: always()\n`],
      ["renamed id", GASLESS_HEAD, "      - name: Gasless mainnet\n        id: gasless2\n"],
    ];
    for (const [label, search, replacement] of mutations) {
      const failures = mainnetE2eWorkflowFailures(mutated(source, search, replacement));
      if (!failures.includes(FAILURE)) throw new Error(`accepted mutation: ${label}`);
    }
  });

  test("rejects duplicate gasless steps even when both carry the condition", async () => {
    const source = await workflow();
    const step = gaslessStep(source);
    const doubled = mutated(source, step, `${step}${step}`);
    expect(mainnetE2eWorkflowFailures(doubled)).toContain(FAILURE);
    expect(gaslessCondition(jobBody(doubled, "execute"))).toBeNull();
  });
});
