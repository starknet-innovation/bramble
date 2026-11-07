/**
 * Workflows other than `mainnet-e2e.yml` that try to reach the mainnet E2E
 * environments or secrets. Each is a whole extra file added to the
 * inventory (or an edit of a real one) and must fail the gate.
 */
const E = "$" + "{{";

/** A baseline-compliant extra workflow whose `deploy` job carries `job` lines. */
const copyWorkflow = (job: string, top = ""): string =>
  `name: Copy\non:\n  workflow_dispatch:\npermissions:\n  contents: read\n${top}jobs:\n  deploy:\n    runs-on: ubuntu-latest\n${job}    steps:\n      - run: echo ok\n`;

/** One boundary mutation: extra files to add, and the failure it must raise. */
export type BoundaryCase = {
  readonly label: string;
  readonly files: Readonly<Record<string, string>>;
  readonly failure: string;
};

const ENV =
  ".github/workflows/copy.yaml job deploy must not use a mainnet E2E environment; only mainnet-e2e.yml may";
const PLAIN =
  ".github/workflows/copy.yaml job deploy must name its environment plainly, as [A-Za-z0-9._-] with no expression";
const reference = (name: string): string =>
  `.github/workflows/copy.yaml must not reference ${name}; only mainnet-e2e.yml may`;
const WHOLE = ".github/workflows/copy.yaml must not read the whole secrets context";

const environment = (label: string, value: string, failure = ENV): BoundaryCase => ({
  label,
  files: { "copy.yaml": copyWorkflow(`    environment: ${value}\n`) },
  failure,
});

const secret = (label: string, expression: string, failure: string): BoundaryCase => ({
  label,
  files: { "copy.yaml": copyWorkflow(`    env:\n      X: ${E} ${expression} }}\n`) },
  failure,
});

/** Every case the boundary must refuse. */
export const BOUNDARY_CASES: readonly BoundaryCase[] = [
  environment("environment mainnet-e2e", "mainnet-e2e"),
  environment("environment MAINNET-E2E", "MAINNET-E2E"),
  environment("environment Mainnet-E2E-Balance", "Mainnet-E2E-Balance"),
  environment("environment ' mainnet-e2e ' (padded)", "' mainnet-e2e '"),
  environment("environment name containing mainnet-e2e", "staging-mainnet-e2e-copy"),
  environment("environment {name: MAINNET-E2E}", "{ name: MAINNET-E2E }"),
  environment(
    "environment {name: mainnet-e2e-balance, url}",
    "{ name: mainnet-e2e-balance, url: https://x.example }",
  ),
  environment("environment from an expression", `${E} inputs.target }}`, PLAIN),
  environment("environment {name: expression}", `{ name: "${E} vars.TARGET }}" }`, PLAIN),
  secret(
    "secrets.MAINNET_E2E_PRIVATE_KEY",
    "secrets.MAINNET_E2E_PRIVATE_KEY",
    reference("MAINNET_E2E_PRIVATE_KEY"),
  ),
  secret(
    "secrets['MAINNET_E2E_RPC_URL']",
    "secrets['MAINNET_E2E_RPC_URL']",
    reference("MAINNET_E2E_RPC_URL"),
  ),
  secret(
    "SECRETS.mainnet_e2e_private_key",
    "SECRETS.mainnet_e2e_private_key",
    reference("MAINNET_E2E_PRIVATE_KEY"),
  ),
  secret(
    "secrets.MAINNET_E2E_PROVER_URL",
    "secrets.MAINNET_E2E_PROVER_URL",
    reference("MAINNET_E2E_PROVER_URL"),
  ),
  secret("toJSON(secrets)", "toJSON(secrets)", WHOLE),
  secret("secrets[format(…)]", "secrets[format('MAINNET_{0}', 'E2E_PRIVATE_KEY')]", WHOLE),
  {
    label: "secrets.MAINNET_E2E_RPC_URL in a bare job if",
    files: { "copy.yaml": copyWorkflow("    if: secrets.MAINNET_E2E_RPC_URL != ''\n") },
    failure: reference("MAINNET_E2E_RPC_URL"),
  },
  {
    label: "secrets: inherit to a reusable workflow",
    files: {
      "copy.yaml": `name: Copy\non:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  deploy:\n    uses: ./.github/workflows/release-build.yml\n    secrets: inherit\n`,
    },
    failure: ".github/workflows/copy.yaml job deploy must not pass secrets: inherit",
  },
  {
    label: "unreviewed local reusable-workflow call",
    files: {
      "copy.yaml": `name: Copy\non:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  deploy:\n    uses: ./.github/workflows/release-build.yml\n`,
    },
    failure: ".github/workflows/copy.yaml job deploy must not call an unreviewed reusable workflow",
  },
  {
    label: "reusable workflow from another repository",
    files: {
      "copy.yaml": `name: Copy\non:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  deploy:\n    uses: someone/else/.github/workflows/x.yml@0123456789abcdef0123456789abcdef01234567\n`,
    },
    failure: ".github/workflows/copy.yaml job deploy must not call an unreviewed reusable workflow",
  },
  {
    label: "environment hidden behind U+2028 in a comment",
    files: { "copy.yaml": copyWorkflow("    # note     environment: mainnet-e2e\n") },
    failure: ".github/workflows/copy.yaml must not contain a bare CR, U+0085, U+2028 or U+2029",
  },
  {
    label: "environment supplied by a merge key",
    files: { "copy.yaml": copyWorkflow("    <<: { environment: mainnet-e2e }\n") },
    failure:
      ".github/workflows/copy.yaml must parse strictly, with no duplicate or merge keys, so the mainnet boundary can be checked",
  },
  {
    label: "duplicate environment key",
    files: {
      "copy.yaml": copyWorkflow("    environment: production\n    environment: mainnet-e2e\n"),
    },
    failure:
      ".github/workflows/copy.yaml must parse strictly, with no duplicate or merge keys, so the mainnet boundary can be checked",
  },
];

/** Extra workflows that stay clear of the boundary and must not be flagged by it. */
export const BOUNDARY_CONTROLS: readonly BoundaryCase[] = [
  {
    label: "another environment and another secret",
    files: {
      "copy.yaml": copyWorkflow(
        `    environment: production\n    env:\n      X: ${E} secrets.OTHER_TOKEN }}\n`,
      ),
    },
    failure: "",
  },
  {
    label: "CRLF line endings",
    files: { "copy.yaml": copyWorkflow("    environment: production\n").replaceAll("\n", "\r\n") },
    failure: "",
  },
];
