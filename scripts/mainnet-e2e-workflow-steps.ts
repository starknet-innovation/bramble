/**
 * The reviewed steps of the Mainnet E2E jobs other than `execute`.
 *
 * `resolve` and `gate` decide whether a run happens at all, so their scripts
 * are stated as named guard blocks that together are the whole script; every
 * other script is compared whole. `preflight` and `post`
 * run trusted `main` code with the RPC secret and nothing else; `build` runs
 * release code with no secret; `report` runs one pinned action and no
 * checkout. Every step list is an allowlist, so an action can appear only in
 * the job reviewed for it (an artifact upload only in `build`, a checkout
 * never in `execute` or `report`).
 */
import { SETUP_BUN, SETUP_NODE } from "./mainnet-e2e-workflow-execute";
import { REPORT_SCRIPT, SUMMARY_SCRIPT } from "./mainnet-e2e-workflow-scripts";
import { type StepShape, script } from "./mainnet-e2e-workflow-shape";

const PATH = ".github/workflows/mainnet-e2e.yml";
const expression = (body: string): string => `\${{ ${body} }}`;
const ADDRESS = expression("vars.MAINNET_E2E_ADDRESS");
const RPC = expression("secrets.MAINNET_E2E_RPC_URL");
const TIER = expression("vars.MAINNET_E2E_STRK20 == 'true' && 'strk20' || 'standard'");

/** Reported when a checkout keeps its token or takes a ref. */
export const CHECKOUT_FAILURE = `${PATH} must check out with persist-credentials: false and no configured ref`;

const CHECKOUT: StepShape = {
  fields: {
    uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    with: { "persist-credentials": false },
  },
  failure: CHECKOUT_FAILURE,
};

const step = (fields: StepShape["fields"], failure: string): StepShape => ({ fields, failure });

const RESOLVE = `${PATH} must resolve the release branch in the reviewed step`;

const RESOLVE_STEPS: readonly StepShape[] = [
  {
    fields: {
      name: "Resolve active release branch",
      id: "pick",
      env: {
        GH_TOKEN: expression("github.token"),
        ACTIVE_RELEASE_BRANCH: expression("vars.ACTIVE_RELEASE_BRANCH"),
        EVENT_NAME: expression("github.event_name"),
        INPUT_BRANCH: expression("github.event.inputs.branch"),
        TRIGGER_REF: expression("github.ref"),
        REPOSITORY_FORK: expression("github.event.repository.fork"),
      },
    },
    controls: [
      {
        lines: [
          `if [ "\${REPOSITORY_FORK}" = "true" ] || [ "$GITHUB_REPOSITORY" != "starknet-innovation/bramble" ]; then`,
          '  echo "::notice::Mainnet E2E does not run outside starknet-innovation/bramble."',
          '  echo "branch=" >> "$GITHUB_OUTPUT"',
          '  echo "revision=" >> "$GITHUB_OUTPUT"',
          "  exit 0",
          "fi",
        ],
        failure: `${PATH} must refuse forks and repositories other than starknet-innovation/bramble`,
      },
      {
        lines: [
          'if [ "$EVENT_NAME" = "workflow_dispatch" ] && [ "$TRIGGER_REF" != "refs/heads/main" ]; then',
          '  echo "::error::Mainnet E2E manual runs must use the workflow from main."; exit 1',
          "fi",
        ],
        failure: `${PATH} manual dispatches must reject workflow revisions outside main`,
      },
      {
        lines: [
          `available="$(gh api --paginate "repos/$GITHUB_REPOSITORY/branches?per_page=100" --jq '.[].name')"`,
          `candidate=""`,
          `if [ -n "\${INPUT_BRANCH:-}" ]; then`,
          `  echo "Using workflow_dispatch input: $INPUT_BRANCH"`,
          `  candidate="$INPUT_BRANCH"`,
          `elif [ -n "\${ACTIVE_RELEASE_BRANCH:-}" ]; then`,
          `  echo "Using vars.ACTIVE_RELEASE_BRANCH: $ACTIVE_RELEASE_BRANCH"`,
          `  candidate="$ACTIVE_RELEASE_BRANCH"`,
          `else`,
          `  echo "Auto-resolving the highest-semver release/* branch ..."`,
          `  branches="$(printf '%s\\n' "$available" | grep -E '^release/v[0-9]+\\.[0-9]+(\\.[0-9]+)?$' || true)"`,
          `  if [ -z "$branches" ]; then`,
          `    echo "No release/* branch found and vars.ACTIVE_RELEASE_BRANCH is unset — nothing to run."`,
          `    echo "branch=" >> "$GITHUB_OUTPUT"`,
          `    echo "revision=" >> "$GITHUB_OUTPUT"`,
          `    exit 0`,
          `  fi`,
          `  best="$(printf '%s\\n' "$branches" | sed 's#^release/v##' | sort -V | tail -1)"`,
          `  candidate="release/v$best"`,
          `fi`,
          ``,
        ],
        failure: RESOLVE,
      },
      {
        lines: [
          'if [[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+(\\.[0-9]+)?$ ]]; then',
          '  echo "::error::Mainnet E2E branch must match release/vX.Y or release/vX.Y.Z exactly."; exit 1',
          "fi",
        ],
        failure: `${PATH} must constrain configured refs to canonical release branches`,
      },
      {
        lines: [
          'if ! grep -Fxq -- "$candidate" <<< "$available"; then',
          `  echo "::error::Mainnet E2E branch '$candidate' does not exist in $GITHUB_REPOSITORY."; exit 1`,
          "fi",
        ],
        failure: `${PATH} must require the exact configured branch to exist in the base repository`,
      },
      {
        lines: [
          `encoded_candidate="\${candidate//\\//%2F}"`,
          `revision="$(gh api "repos/$GITHUB_REPOSITORY/commits/$encoded_candidate" --jq '.sha')"`,
          'if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then',
          '  echo "::error::Mainnet E2E branch did not resolve to an immutable commit."; exit 1',
          "fi",
          'echo "Resolved: $candidate at $revision"',
          'echo "branch=$candidate" >> "$GITHUB_OUTPUT"',
          'echo "revision=$revision" >> "$GITHUB_OUTPUT"',
        ],
        failure: `${PATH} must resolve the selected branch to an immutable commit`,
      },
    ],
    failure: RESOLVE,
  },
];

const CONFIGURED = `${PATH} must skip until maintainers set vars.MAINNET_E2E_CONFIGURED`;

const GATE: readonly StepShape[] = [
  {
    fields: {
      name: "Skip until maintainers enable the hot wallet",
      id: "decide",
      env: {
        CONFIGURED: expression("vars.MAINNET_E2E_CONFIGURED"),
        BRANCH: expression("needs.resolve.outputs.branch"),
      },
    },
    controls: [
      {
        lines: [
          'if [ "$CONFIGURED" != "true" ]; then',
          '  echo "::notice::Mainnet E2E is not configured. Set vars.MAINNET_E2E_CONFIGURED=true after creating the mainnet-e2e environment. See docs/MAINNET_E2E_CI.md."',
          '  echo "### Mainnet E2E skipped for \\`$BRANCH\\`. \\`vars.MAINNET_E2E_CONFIGURED\\` is not true, so no runner started and no secret was read. See docs/MAINNET_E2E_CI.md." >> "$GITHUB_STEP_SUMMARY"',
        ],
        failure: CONFIGURED,
      },
      {
        lines: [
          '  echo "run=false" >> "$GITHUB_OUTPUT"',
          "  exit 0",
          "fi",
          'echo "Mainnet E2E is configured for $BRANCH."',
          'echo "run=true" >> "$GITHUB_OUTPUT"',
        ],
        failure: CONFIGURED,
      },
    ],
    failure: CONFIGURED,
  },
];

const BALANCE_ENV = {
  MAINNET_E2E_ADDRESS: ADDRESS,
  MAINNET_E2E_RPC_URL: RPC,
  MAINNET_E2E_SPEND_TIER: TIER,
} as const;

const TRUSTED_INSTALL = {
  name: "Install trusted dependencies from main",
  run: script(["bun install --frozen-lockfile"]),
};

const PREFLIGHT: readonly StepShape[] = [
  CHECKOUT,
  step(SETUP_BUN, "the preflight balance check must run trusted main code without the key"),
  step(TRUSTED_INSTALL, "the preflight balance check must run trusted main code without the key"),
  step(
    {
      name: "Preflight hot-wallet balance",
      id: "balance",
      env: BALANCE_ENV,
      run: script([
        "set -euo pipefail",
        'if [ -z "$MAINNET_E2E_ADDRESS" ] || [ -z "$MAINNET_E2E_RPC_URL" ]; then',
        '  echo "::error::Set vars.MAINNET_E2E_ADDRESS and the mainnet-e2e-balance secret MAINNET_E2E_RPC_URL."; exit 1',
        "fi",
        'echo "::add-mask::$MAINNET_E2E_RPC_URL"',
        'MAINNET_E2E_REPORT_FILE="$GITHUB_OUTPUT" bun run scripts/mainnet-e2e-balance.ts preflight',
      ]),
    },
    "the preflight balance check must run the reviewed trusted script",
  ),
];

/** Reported when the post-run baseline is not read from the preflight job's outputs. */
export const BASELINE_FAILURE =
  "the post-run check must take its baseline from the preflight job output";

const POST: readonly StepShape[] = [
  CHECKOUT,
  step(SETUP_BUN, "the post balance check must run trusted main code without the key"),
  step(TRUSTED_INSTALL, "the post balance check must run trusted main code without the key"),
  step(
    {
      name: "Post-run balance",
      id: "balance",
      env: {
        ...BALANCE_ENV,
        MAINNET_E2E_STRK_BEFORE_RAW: expression("needs.preflight.outputs.strk_before_raw"),
        MAINNET_E2E_USDC_BEFORE_RAW: expression("needs.preflight.outputs.usdc_before_raw"),
      },
      run: script([
        "set -euo pipefail",
        'echo "::add-mask::$MAINNET_E2E_RPC_URL"',
        'MAINNET_E2E_REPORT_FILE="$GITHUB_OUTPUT" bun run scripts/mainnet-e2e-balance.ts post',
      ]),
    },
    BASELINE_FAILURE,
  ),
  step(
    {
      name: "Summary",
      if: "always()",
      env: {
        BRANCH: expression("needs.resolve.outputs.branch"),
        REVISION: expression("needs.resolve.outputs.revision"),
        ADDRESS,
        VERDICT: expression("steps.balance.outputs.verdict"),
        STRK: ["strk_before", "strk_after", "strk_delta"]
          .map((output) => expression(`steps.balance.outputs.${output}`))
          .join(" | "),
        USDC: ["usdc_before", "usdc_after", "usdc_delta"]
          .map((output) => expression(`steps.balance.outputs.${output}`))
          .join(" | "),
        BUILD: expression("needs.build.result"),
        EXECUTE: expression("needs.execute.result"),
        PLAYWRIGHT: expression("needs.execute.outputs.playwright || 'not run'"),
        GASLESS: expression("needs.execute.outputs.gasless || 'not run'"),
      },
      run: script(SUMMARY_SCRIPT),
    },
    "the post job must end with the reviewed summary step",
  ),
];

const KEYLESS = "the mainnet build runs release code and must not receive any secret";

const BUILD: readonly StepShape[] = [
  CHECKOUT,
  {
    fields: {
      name: "Check out resolved release commit",
      env: {
        REVISION: expression("needs.resolve.outputs.revision"),
        FETCH_TOKEN: expression("github.token"),
      },
    },
    controls: [
      {
        lines: [
          'if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]; then',
          '  echo "::error::Mainnet E2E revision must be a full lowercase SHA-1."; exit 1',
          "fi",
        ],
        failure: "the mainnet build must validate the resolved immutable commit",
      },
      {
        lines: [
          `basic="$(printf 'x-access-token:%s' "$FETCH_TOKEN" | base64 -w0)"`,
          'echo "::add-mask::$basic"',
          "GIT_CONFIG_COUNT=1 \\",
          '  GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \\',
          '  GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $basic" \\',
          '  git fetch --no-tags --depth=1 origin "$REVISION"',
          'if [ "$(git rev-parse FETCH_HEAD)" != "$REVISION" ]; then',
          '  echo "::error::Fetched mainnet revision does not match the resolved commit."; exit 1',
          "fi",
          'git checkout --detach "$REVISION"',
        ],
        failure: "the mainnet build must detach onto the resolved immutable commit",
      },
    ],
    failure: "the mainnet build must consume the resolved immutable commit",
  },
  step(SETUP_BUN, KEYLESS),
  step(SETUP_NODE, KEYLESS),
  step({ name: "Install dependencies", run: script(["bun install --frozen-lockfile"]) }, KEYLESS),
  step(
    {
      name: "Verify pinned upstreams",
      run: script(["bun run vendor:argent && bun run vendor:privacy"]),
    },
    KEYLESS,
  ),
  step({ name: "Build extension", run: script(["bun run build"]) }, KEYLESS),
  step(
    {
      name: "Install E2E browser into the workspace",
      env: { PLAYWRIGHT_BROWSERS_PATH: `${expression("github.workspace")}/.playwright-browsers` },
      run: script(["bun run test:e2e:install"]),
    },
    KEYLESS,
  ),
  step(
    {
      name: "Pack the build",
      id: "pack",
      run: script([
        "set -euo pipefail",
        'bundle="$RUNNER_TEMP/mainnet-e2e-bundle.tar"',
        'tar --exclude=./.git -cf "$bundle" .',
        `echo "sha256=$(sha256sum "$bundle" | cut -d' ' -f1)" >> "$GITHUB_OUTPUT"`,
      ]),
    },
    "the mainnet build must publish the hash of the bundle it packed",
  ),
  step(
    {
      uses: "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9",
      with: {
        name: "mainnet-e2e-bundle",
        path: `${expression("runner.temp")}/mainnet-e2e-bundle.tar`,
        "if-no-files-found": "error",
        "retention-days": 1,
      },
    },
    `${PATH} may upload artifacts only from the keyless build job`,
  ),
];

const post = (output: string): string => expression(`needs.post.outputs.${output}`);

const REPORT: readonly StepShape[] = [
  step(
    {
      name: "Upsert mainnet tracking issue",
      uses: "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
      env: {
        BRANCH: expression("needs.resolve.outputs.branch"),
        REVISION: expression("needs.resolve.outputs.revision"),
        ADDRESS,
        TIER,
        VERDICT: post("verdict"),
        STRK_BEFORE: post("strk_before"),
        STRK_AFTER: post("strk_after"),
        STRK_DELTA: post("strk_delta"),
        USDC_BEFORE: post("usdc_before"),
        USDC_AFTER: post("usdc_after"),
        USDC_DELTA: post("usdc_delta"),
        JOBS: `preflight ${expression("needs.preflight.result")}, build ${expression("needs.build.result")}, tests ${expression("needs.execute.result")}, post-run balance ${expression("needs.post.result")}`,
      },
      with: { script: script(REPORT_SCRIPT) },
    },
    "the hosted mainnet reporter must not check out or execute release-branch source",
  ),
];

/** Each non-`execute` job's reviewed steps, in order. */
export const OTHER_JOB_STEPS: Readonly<Record<string, readonly StepShape[]>> = {
  resolve: RESOLVE_STEPS,
  gate: GATE,
  preflight: PREFLIGHT,
  build: BUILD,
  post: POST,
  report: REPORT,
};
