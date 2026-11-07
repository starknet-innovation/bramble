/**
 * Edits that make a workflow read differently to `Bun.YAML` (which the Ledger
 * E2E and website-deploy policies used) than to GitHub's runner, or that the
 * text rules let through. Each must now fail the full workflow gate with the
 * named failure. The controls are spellings that decode to the reviewed
 * workflow and must still be read as such. Shared by the tests and by the
 * fail-without comparison against the release head, so both run the same
 * inputs.
 */

/** One edit of a repository workflow and a failure the gate must report for it. */
export type StrictYamlMutation = {
  readonly workflow: string;
  readonly label: string;
  /** Text placed before the file. */
  readonly prefix: string;
  /** Replacements applied in order, each to the first occurrence of its search text. */
  readonly edits: readonly (readonly [string, string])[];
  /** Text a failure the gate reports must contain (every failure starts with the file path). */
  readonly failure: string;
};

const E = "$" + "{{";
const LEDGER = "ledger-e2e.yml";
const WEBSITE = "website-deploy.yml";

/** Failure ends shared by both policies. */
export const FAILURE = {
  boolean: "must write every boolean as plain true or false",
  directive: "must not use YAML directives (%YAML, %TAG or any % line)",
  doubleQuoted: "must keep every plain or quoted scalar on one line",
  indirection: "must not use YAML anchors, aliases, tags or merge keys",
  number: "must write every number as a plain decimal integer",
  pin: "update LEDGER_E2E_SHA256 in scripts/ledger-e2e-workflow-policy.ts",
  quote: (text: string) =>
    `must quote ${text}, which another YAML reader types as a number or boolean`,
} as const;

const SEPARATORS = [
  ["bare CR", "\r", "U+000D"],
  ["U+0085", "\u0085", "U+0085"],
  ["U+2028", " ", "U+2028"],
  ["U+2029", " ", "U+2029"],
] as const;

const RECORD_CHECKOUT =
  "        with:\n          persist-credentials: false\n      - uses: oven-sh/setup-bun@";
const SUITE_STEP = "      - name: Speculos Ledger E2E\n";
const BRANCHES = 'branches: [main, "release/**"]';

const ledger = (
  label: string,
  edits: readonly (readonly [string, string])[],
  failure: string,
  prefix = "",
): StrictYamlMutation => ({ workflow: LEDGER, label, prefix, edits, failure });

const website = (
  label: string,
  edits: readonly (readonly [string, string])[],
  failure: string,
  prefix = "",
  workflow = WEBSITE,
): StrictYamlMutation => ({ workflow, label, prefix, edits, failure });

/** The rows of issue #887's table, which the Ledger policy at the release head accepted (but one). */
export const LEDGER_ISSUE_ROWS: readonly StrictYamlMutation[] = [
  ledger(
    "%YAML 1.1 with quoted on",
    [["\non:\n", '\n"on":\n']],
    FAILURE.directive,
    "%YAML 1.1\n---\n",
  ),
  ledger("node-version: 0x18", [["node-version: 24", "node-version: 0x18"]], FAILURE.number),
  ledger(
    "cancel-in-progress: True",
    [["cancel-in-progress: true", "cancel-in-progress: True"]],
    FAILURE.boolean,
  ),
  ledger(
    "persist-credentials: no",
    [[RECORD_CHECKOUT, RECORD_CHECKOUT.replace("false", "no")]],
    FAILURE.quote("no"),
  ),
  ledger(
    "default: off for record_hashes",
    [["        default: false\n", "        default: off\n"]],
    FAILURE.quote("off"),
  ),
  ledger(
    "timeout-minutes: 0x3C",
    [["        timeout-minutes: 60\n", "        timeout-minutes: 0x3C\n"]],
    FAILURE.number,
  ),
  ledger("retention-days: 0o7", [["retention-days: 7", "retention-days: 0o7"]], FAILURE.number),
];

/** Further Ledger edits: hidden lines, parser-specific forms and a byte change. */
export const LEDGER_MORE_ROWS: readonly StrictYamlMutation[] = [
  ...SEPARATORS.flatMap(([name, separator, codePoint]) => [
    ledger(
      `${name} hides an extra speculos step in a comment`,
      [
        [
          SUITE_STEP,
          `      # reviewed${separator}      - run: echo unreviewed step\n${SUITE_STEP}`,
        ],
      ],
      `must not contain ${codePoint}`,
    ),
    ledger(
      `${name} hides a %YAML 1.1 directive in a comment`,
      [],
      `must not contain ${codePoint}`,
      `# reviewed${separator}%YAML 1.1\n---\n`,
    ),
  ]),
  ledger(
    "double-quoted run continued by an escaped newline",
    [
      [
        "        run: bun run vendor:ledger-app\n",
        '        run: "bun run vendor:\\\n          ledger-app"\n',
      ],
    ],
    FAILURE.doubleQuoted,
  ),
  ledger(
    "merge key supplies persist-credentials: false (GitHub reads a literal << key)",
    [
      [
        RECORD_CHECKOUT,
        RECORD_CHECKOUT.replace("persist-credentials: false", "<<: {persist-credentials: false}"),
      ],
    ],
    FAILURE.indirection,
  ),
  ledger(
    "anchor and alias share the branch filter",
    [
      [BRANCHES, BRANCHES.replace("[", "&branches [")],
      [BRANCHES, "branches: *branches"],
    ],
    FAILURE.indirection,
  ),
  ledger(
    "explicit !!bool tag on persist-credentials",
    [[RECORD_CHECKOUT, RECORD_CHECKOUT.replace("false", "!!bool false")]],
    FAILURE.indirection,
  ),
  ledger(
    "duplicate timeout-minutes key (Bun.YAML keeps the last)",
    [["    timeout-minutes: 90\n", "    timeout-minutes: 1\n    timeout-minutes: 90\n"]],
    "must be parseable YAML so its controls can be checked",
  ),
  ledger("one comment line added at the top", [], FAILURE.pin, "#\n"),
];

const DEPLOY_STEPS = "    steps:\n";
const TOKEN_BINDING = `          CLOUDFLARE_API_TOKEN: ${E} secrets.CLOUDFLARE_API_TOKEN }}\n`;
const CI_JOBS = "\njobs:\n";

/** Website-deploy edits, and edits of another workflow the policy also reads. */
export const WEBSITE_ROWS: readonly StrictYamlMutation[] = [
  website("%YAML 1.1 directive", [], FAILURE.directive, "%YAML 1.1\n---\n"),
  ...SEPARATORS.flatMap(([name, separator, codePoint]) => [
    website(
      `${name} hides a job-level token binding in a comment`,
      [
        [
          DEPLOY_STEPS,
          `    # reviewed${separator}    env: {LEAKED: "${E} secrets.CLOUDFLARE_API_TOKEN }}"}\n${DEPLOY_STEPS}`,
        ],
      ],
      `must not contain ${codePoint}`,
    ),
    website(
      `${name} hides a %YAML 1.1 directive in a comment`,
      [],
      `must not contain ${codePoint}`,
      `# reviewed${separator}%YAML 1.1\n---\n`,
    ),
    website(
      `${name} hides a secrets dump in ci.yml`,
      [
        [
          CI_JOBS,
          `\n# reviewed${separator}env: {ALL: "${E} toJSON(\\u0073ecrets) }}"}\n${CI_JOBS}`,
        ],
      ],
      `must not contain ${codePoint}`,
      "",
      "ci.yml",
    ),
  ]),
  website(
    "token binding continued by an escaped newline",
    [
      [
        TOKEN_BINDING,
        `          CLOUDFLARE_API_TOKEN: "${E} secrets.CLOUDFLARE_\\\n            API_TOKEN }}"\n`,
      ],
    ],
    FAILURE.doubleQuoted,
  ),
  website(
    "duplicate environment key (Bun.YAML keeps the last)",
    [
      [
        "      url: https://bramble.fi\n",
        "      url: https://bramble.fi\n    environment: bramble-preview\n",
      ],
    ],
    "must be parseable YAML so its trust boundaries can be checked",
  ),
  website(
    "merge key in the deploy step env",
    [[TOKEN_BINDING, `${TOKEN_BINDING}          <<: {CLOUDFLARE_ACCOUNT_ID: x}\n`]],
    FAILURE.indirection,
  ),
  website(
    "token in an env key of the install step",
    [
      [
        "        run: bun install --frozen-lockfile\n",
        `        env:\n          'LEAK_${E} secrets.CLOUDFLARE_API_TOKEN }}': "1"\n        run: bun install --frozen-lockfile\n`,
      ],
    ],
    `not at jobs.deploy.steps[3].env.LEAK_${E} secrets.CLOUDFLARE_API_TOKEN }} (key)`,
  ),
  website(
    "quoted pull_request trigger key",
    [["  workflow_dispatch:\n", '  "pull_request":\n  workflow_dispatch:\n']],
    "must never run on a pull-request revision",
  ),
  website(
    "secrets dump after a '}}' literal in ci.yml",
    [[CI_JOBS, `\nenv:\n  ALL: "${E} format('}}{0}', toJSON(\\u0073ecrets)) }}"\n${CI_JOBS}`]],
    "must not serialise the whole secrets context (at env.ALL)",
    "",
    "ci.yml",
  ),
  website(
    "token read by a computed name in ci.yml",
    [[CI_JOBS, `\nenv:\n  T: ${E} secrets[format('CLOUDFLARE_API_{0}', 'TOKEN')] }}\n${CI_JOBS}`]],
    "must not read a secret by a computed name (at env.T)",
    "",
    "ci.yml",
  ),
];

/** One spelling that decodes to the reviewed workflow; the policy must read it so. */
export type StrictYamlControl = Omit<StrictYamlMutation, "failure">;

/** Ledger spellings the decoded checks accept; only the byte pin rejects them. */
export const LEDGER_CONTROLS: readonly StrictYamlControl[] = [
  {
    workflow: LEDGER,
    label: "comment between steps",
    prefix: "",
    edits: [[SUITE_STEP, `      # reviewed — no change\n${SUITE_STEP}`]],
  },
  { workflow: LEDGER, label: "leading BOM and document start", prefix: "﻿---\n", edits: [] },
  {
    workflow: LEDGER,
    label: "single-quoted run",
    prefix: "",
    edits: [["      - run: bun run build\n", "      - run: 'bun run build'\n"]],
  },
  {
    workflow: LEDGER,
    label: "flow-style permissions",
    prefix: "",
    edits: [["permissions:\n  contents: read\n", "permissions: {contents: read}\n"]],
  },
  {
    workflow: LEDGER,
    label: "single-line double-quoted runner",
    prefix: "",
    edits: [["runs-on: ubuntu-latest", 'runs-on: "ubuntu-latest"']],
  },
];

/** Website and other-workflow spellings the full gate accepts. */
export const WEBSITE_CONTROLS: readonly StrictYamlControl[] = [
  {
    workflow: WEBSITE,
    label: "comment and em dash in the deploy job",
    prefix: "",
    edits: [[DEPLOY_STEPS, `    # reviewed — no change\n${DEPLOY_STEPS}`]],
  },
  { workflow: WEBSITE, label: "document start marker", prefix: "---\n", edits: [] },
  {
    workflow: WEBSITE,
    label: "single-line double-quoted token binding",
    prefix: "",
    edits: [
      [TOKEN_BINDING, `          CLOUDFLARE_API_TOKEN: "${E} secrets.CLOUDFLARE_API_TOKEN }}"\n`],
    ],
  },
  {
    workflow: WEBSITE,
    label: "environment as a flow mapping",
    prefix: "",
    edits: [
      [
        "    environment:\n      name: bramble-production\n      url: https://bramble.fi\n",
        "    environment: {name: bramble-production, url: https://bramble.fi}\n",
      ],
    ],
  },
  {
    workflow: "ci.yml",
    label: "ci.yml keeps an anchor and a non-ASCII comment",
    prefix: "# ci → note\n",
    edits: [["name: CI\n", "name: &workflow CI\n"]],
  },
];

/** `source` with `mutation`'s prefix and edits applied; throws when a search text is missing. */
export const applyEdits = (source: string, mutation: StrictYamlControl): string =>
  mutation.edits.reduce((text, [search, replacement]) => {
    if (!text.includes(search))
      throw new Error(`${mutation.label}: missing ${JSON.stringify(search)}`);
    return text.replace(search, () => replacement);
  }, `${mutation.prefix}${source}`);
