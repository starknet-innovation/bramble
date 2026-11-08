/**
 * The gasless step's `if:` and the execute job's own `if:` are read from the
 * parsed YAML document. Each weakening below keeps the reviewed text in the
 * file and must still fail; each spelling that decodes to the reviewed value
 * must pass.
 */
import { describe, expect, test } from "bun:test";
import {
  GASLESS_CONDITION,
  GASLESS_CONDITION_FAILURE,
  mainnetE2eDocumentFailures,
} from "../../scripts/mainnet-e2e-workflow-document";
import { mainnetE2eWorkflowFailures } from "../../scripts/mainnet-e2e-workflow-policy";
import { readWorkflowSources } from "../../scripts/workflow-inventory";

const WORKFLOW = "mainnet-e2e.yml";
const PARSE = ".github/workflows/mainnet-e2e.yml must parse as YAML with no duplicate keys";
const INDIRECTION =
  ".github/workflows/mainnet-e2e.yml must not use YAML anchors, aliases, tags or merge keys";
const EXECUTE_IF = "mainnet execution must not run after a failed or cancelled job it needs";
const IF_LINE = `        if: ${GASLESS_CONDITION}\n`;
const ID_LINE = "        id: gasless\n";
const HEAD = `      - name: Gasless mainnet\n${ID_LINE}`;
const EXPRESSION = "$" + "{{";
const ONE_LINE =
  ".github/workflows/mainnet-e2e.yml must keep every plain or quoted scalar on one line";
const FOLDED = ".github/workflows/mainnet-e2e.yml must not use folded (>) block scalars";

const workflow = async (): Promise<string> => (await readWorkflowSources())[WORKFLOW] ?? "";

const mutated = (source: string, search: string, replacement: string): string => {
  expect(source).toContain(search);
  return source.replace(search, replacement);
};

const gaslessStep = (source: string): string => {
  const at = source.indexOf(HEAD);
  expect(at).toBeGreaterThan(0);
  return source.slice(at, source.indexOf("      - name: Require the gasless send\n", at));
};

type Mutation = readonly [label: string, search: string, replacement: string, failure: string];

const WEAKENED: readonly Mutation[] = [
  ["appended || always()", IF_LINE, `        if: ${GASLESS_CONDITION} || always()\n`, ""],
  ["appended || true", IF_LINE, `        if: ${GASLESS_CONDITION} || true\n`, ""],
  ["always() prefix", IF_LINE, `        if: always() && ${GASLESS_CONDITION}\n`, ""],
  [
    "inner quotes changed",
    IF_LINE,
    `        if: ${GASLESS_CONDITION.replace("'success'", '"success"')}\n`,
    "",
  ],
  ["expression wrapper", IF_LINE, `        if: ${EXPRESSION} ${GASLESS_CONDITION} }}\n`, ""],
  ["only in a comment", IF_LINE, `        # if: ${GASLESS_CONDITION}\n        if: always()\n`, ""],
  ["no if", IF_LINE, "", ""],
  [
    "on a different step",
    `${HEAD}${IF_LINE}`,
    `      - name: Decoy\n${IF_LINE}        run: "true"\n${HEAD}        if: always()\n`,
    "",
  ],
  ["renamed id", ID_LINE, "        id: gasless2\n", ""],
  ["folded continuation", IF_LINE, `${IF_LINE}          || always()\n`, ONE_LINE],
  // Folding differs between parsers, so a folded block is refused outright.
  ["folded block", IF_LINE, `        if: >-\n          ${GASLESS_CONDITION}\n`, FOLDED],
  ["literal block", IF_LINE, `        if: |\n          ${GASLESS_CONDITION}\n`, ""],
  [
    "next-line value, weakened",
    IF_LINE,
    `        if:\n          ${GASLESS_CONDITION} || always()\n`,
    "",
  ],
  [
    "quoted id, weakened",
    `${ID_LINE}${IF_LINE}`,
    `        id: "gasless"\n        if: always()\n`,
    "",
  ],
  ["non-string if", IF_LINE, "        if: true\n", ""],
  ["two if lines", IF_LINE, `${IF_LINE}        if: always()\n`, PARSE],
  [
    "duplicate if, second weaker",
    IF_LINE,
    `${IF_LINE}        if: ${GASLESS_CONDITION} || true\n`,
    PARSE,
  ],
  ["alias supplies the if", IF_LINE, `        if: *reviewed\n`, INDIRECTION],
  ["explicit tag", IF_LINE, "        if: !!str always()\n", INDIRECTION],
  ["merge key", ID_LINE, `${ID_LINE}        <<: { shell: bash }\n`, INDIRECTION],
  ["unparseable", IF_LINE, `        if: "${GASLESS_CONDITION}\n`, PARSE],
];

// Spellings GitHub decodes to exactly the reviewed condition.
const EQUIVALENT: readonly (readonly [label: string, search: string, replacement: string])[] = [
  ["double-quoted", IF_LINE, `        if: "${GASLESS_CONDITION}"\n`],
  ["trailing comment", IF_LINE, `        if: ${GASLESS_CONDITION} # reviewed\n`],
  ["next-line value", IF_LINE, `        if:\n          ${GASLESS_CONDITION}\n`],
  ["quoted id", ID_LINE, `        id: "gasless"\n`],
];

describe("mainnet E2E gasless step condition", () => {
  test("the repository workflow carries exactly the reviewed condition", async () => {
    const source = await workflow();
    expect(mainnetE2eDocumentFailures(source)).toEqual([]);
    expect(mainnetE2eWorkflowFailures(source)).not.toContain(GASLESS_CONDITION_FAILURE);
  });

  test("rejects a weakened, reworded, relocated or indirect condition", async () => {
    const source = await workflow();
    const anchored = mutated(source, "  execute:\n", "  execute:\n    x-reviewed: &reviewed x\n");
    for (const [label, search, replacement, failure] of WEAKENED) {
      const base = label === "alias supplies the if" ? anchored : source;
      const failures = mainnetE2eWorkflowFailures(mutated(base, search, replacement));
      const expected = failure === "" ? GASLESS_CONDITION_FAILURE : failure;
      if (!failures.includes(expected)) throw new Error(`accepted mutation: ${label}`);
    }
  });

  test("accepts spellings that decode to the reviewed condition", async () => {
    const source = await workflow();
    for (const [label, search, replacement] of EQUIVALENT) {
      const failures = mainnetE2eDocumentFailures(mutated(source, search, replacement));
      if (failures.length > 0) throw new Error(`rejected equivalent: ${label}`);
    }
  });

  test("reads CRLF line endings the way GitHub does", async () => {
    const crlf = (text: string): string => text.replaceAll("\n", "\r\n");
    const source = await workflow();
    expect(mainnetE2eDocumentFailures(crlf(source))).toEqual([]);
    const folded = mutated(source, IF_LINE, `${IF_LINE}          || always()\n`);
    expect(mainnetE2eDocumentFailures(crlf(folded))).toContain(ONE_LINE);
  });

  test("rejects a flow-mapping gasless step that weakens the condition", async () => {
    const source = await workflow();
    const step = gaslessStep(source);
    const flow = `      - { id: gasless, if: "${GASLESS_CONDITION} || always()", run: "true" }\n`;
    expect(mainnetE2eDocumentFailures(mutated(source, step, flow))).toContain(
      GASLESS_CONDITION_FAILURE,
    );
    // The reviewed condition in flow style passes this check; the rest of the
    // step is no longer the reviewed one, so the step allowlist still fails.
    const exact = `      - { id: gasless, if: "${GASLESS_CONDITION}", run: "true" }\n`;
    const failures = mainnetE2eDocumentFailures(mutated(source, step, exact));
    expect(failures).not.toContain(GASLESS_CONDITION_FAILURE);
    expect(failures).toContain("mainnet execution must fail unless the gasless send succeeded");
  });

  test("rejects duplicate gasless steps, or one in another job", async () => {
    const source = await workflow();
    const step = gaslessStep(source);
    expect(mainnetE2eDocumentFailures(mutated(source, step, `${step}${step}`))).toContain(
      GASLESS_CONDITION_FAILURE,
    );
    const moved = mutated(
      mutated(source, step, ""),
      "      - name: Post-run balance\n",
      `${step}      - name: Post-run balance\n`,
    );
    expect(mainnetE2eDocumentFailures(moved)).toContain(GASLESS_CONDITION_FAILURE);
  });

  test("rejects an execute job that runs after a failed or cancelled need", async () => {
    const source = await workflow();
    const line = "    if: needs.gate.outputs.run == 'true' && needs.preflight.result == 'success'";
    for (const prefix of ["always() && ", `${EXPRESSION} !cancelled() }} && `, "failure() || "]) {
      const changed = mutated(source, line, line.replace("if: ", `if: ${prefix}`));
      expect(mainnetE2eDocumentFailures(changed)).toContain(EXECUTE_IF);
    }
  });

  test("keeps the execute condition and each job's environment exact", async () => {
    const source = await workflow();
    const line = "    if: needs.gate.outputs.run == 'true' && needs.preflight.result == 'success'";
    const weaker = mutated(source, line, `${line} || true`);
    expect(mainnetE2eDocumentFailures(weaker)).toContain(
      "mainnet execution must keep its reviewed job condition",
    );
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      [
        "      name: mainnet-e2e\n    permissions:",
        "      name: mainnet-e2e-staging\n    permissions:",
        "execute",
      ],
      [
        "      name: mainnet-e2e\n    permissions:",
        "      name: mainnet-e2e\n      url: https://x.example\n    permissions:",
        "execute",
      ],
      [
        "    environment:\n      name: mainnet-e2e-balance\n",
        "    environment:\n      name: mainnet-e2e\n",
        "preflight",
      ],
      [
        "  build:\n    needs: [resolve, gate]\n",
        "  build:\n    needs: [resolve, gate]\n    environment: mainnet-e2e\n",
        "build",
      ],
    ];
    for (const [search, replacement, job] of cases) {
      expect(mainnetE2eDocumentFailures(mutated(source, search, replacement))).toContain(
        `the ${job} job must use only its reviewed environment`,
      );
    }
  });
});
