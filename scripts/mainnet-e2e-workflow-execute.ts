/**
 * The reviewed steps of the Mainnet E2E `execute` job, the one job that holds
 * the funded hot-wallet key.
 *
 * The list is an allowlist: exactly these steps, in this order, with exactly
 * these keys. Every action is pinned to the reviewed commit, so no checkout,
 * local (`./`) action, install, build or vendoring step can join the job
 * without failing the match. The bundle is verified before anything reads it,
 * the secrets step checks configuration and the RPC before any live test, and
 * every refusal keeps its `exit 1`. No step may carry an `if:` other than the
 * reviewed one, so none can be skipped while its text stays in place.
 */
import { type Control, type StepShape, script } from "./mainnet-e2e-workflow-shape";

const expression = (body: string): string => `\${{ ${body} }}`;
const secret = (name: string): string => expression(`secrets.${name}`);
const KEY = secret("MAINNET_E2E_PRIVATE_KEY");
const RPC = secret("MAINNET_E2E_RPC_URL");
const DISCOVERY = secret("MAINNET_E2E_DISCOVERY_URL");
const PROVER = secret("MAINNET_E2E_PROVER_URL");
const ADDRESS = expression("vars.MAINNET_E2E_ADDRESS");

/** The pinned Bun setup every Bun job uses. */
export const SETUP_BUN = {
  uses: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
  with: { "bun-version": "1.3.3" },
} as const;

/** The pinned Node setup the build and the tests use. */
export const SETUP_NODE = {
  uses: "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
  with: { "node-version": 24 },
} as const;

/** Reported when the execute job's steps are not exactly the reviewed list. */
export const EXECUTE_ORDER =
  "mainnet execution must run exactly the reviewed steps, in order: no install, build or checkout, and the RPC check before any live test";

/** Reported when the bundle is not verified before it is used. */
export const BUNDLE_FAILURE = "mainnet execution must verify the build bundle it runs";

/** Reported when the secrets step is missing or differs from the reviewed one. */
export const SECRETS_STEP_FAILURE =
  "mainnet execution must keep the reviewed secrets step (id, env bindings and position) that later steps depend on";

const SAME_RPC = "mainnet execution must use exactly the RPC preflight validated";
const REFUSED_RPC =
  "mainnet execution must refuse a non-HTTPS, shared, unavailable or non-mainnet RPC";
const MISSING = "mainnet execution must fail when any hot-wallet secret is missing";
const MASKED = "mainnet execution must mask the hot-wallet secrets";
const GUARD = "mainnet execution must end by requiring a passed gasless send";

const SECRETS_CONTROLS: readonly Control[] = [
  {
    lines: [
      "mask() {",
      '  [ -z "$1" ] && return 0',
      `  case "$1" in *$'\\n'*|*$'\\r'*) echo "::error::A mainnet secret contains a newline."; exit 1 ;; esac`,
      '  echo "::add-mask::$1"',
      "}",
      'mask "$MAINNET_E2E_PRIVATE_KEY"',
      `if [ -n "\${MAINNET_E2E_PRIVATE_KEY}" ]; then`,
      `  stripped="\${MAINNET_E2E_PRIVATE_KEY#0x}"`,
      '  mask "$stripped"',
      `  mask "\${stripped,,}"`,
      `  mask "\${stripped^^}"`,
      "fi",
      'mask "$MAINNET_E2E_RPC_URL"',
      'mask "$MAINNET_E2E_DISCOVERY_URL"',
      'mask "$MAINNET_E2E_PROVER_URL"',
    ],
    failure: MASKED,
  },
  {
    lines: [
      "missing=()",
      '[ -z "$MAINNET_E2E_ADDRESS" ] && missing+=("vars.MAINNET_E2E_ADDRESS")',
      '[ -z "$MAINNET_E2E_PRIVATE_KEY" ] && missing+=("MAINNET_E2E_PRIVATE_KEY")',
      '[ -z "$MAINNET_E2E_RPC_URL" ] && missing+=("MAINNET_E2E_RPC_URL")',
      'if [ "$MAINNET_E2E_STRK20" = "true" ]; then',
      '  [ -z "$MAINNET_E2E_DISCOVERY_URL" ] && missing+=("MAINNET_E2E_DISCOVERY_URL")',
      '  [ -z "$MAINNET_E2E_PROVER_URL" ] && missing+=("MAINNET_E2E_PROVER_URL")',
      "fi",
    ],
    failure: MISSING,
  },
  {
    lines: [
      `if [ "\${#missing[@]}" -ne 0 ]; then`,
      `  echo "::error::mainnet-e2e is enabled but not fully configured. Missing: \${missing[*]}"; exit 1`,
      "fi",
    ],
    failure: MISSING,
  },
  {
    lines: [
      `actual="$(printf '%s' "$MAINNET_E2E_RPC_URL" | sha256sum | cut -d' ' -f1)"`,
      'if [[ ! "$PREFLIGHT_RPC_SHA256" =~ ^[0-9a-f]{64}$ ]] || [ "$actual" != "$PREFLIGHT_RPC_SHA256" ]; then',
      '  echo "::error::The mainnet-e2e RPC is not the one preflight validated."; exit 1',
      "fi",
    ],
    failure: SAME_RPC,
  },
  {
    lines: [
      '[[ "$MAINNET_E2E_RPC_URL" == https://* ]] || { echo "::error::The mainnet RPC must be HTTPS."; exit 1; }',
      `host="\${MAINNET_E2E_RPC_URL#https://}"; host="\${host%%[/?#]*}"; host="\${host##*@}"; host="\${host%%:*}"; host="\${host%.}"`,
      `case "\${host,,}" in wallet.nodes.starknet.org|mainnet.nodes.starknet.org) echo "::error::The mainnet RPC must be a dedicated test endpoint."; exit 1 ;; esac`,
      `body="$(printf 'url = "%s"\\n' "$MAINNET_E2E_RPC_URL" | curl -K - -sfg --proto '=https' -m 20 -w '\\n%{http_code}' -H 'content-type: application/json' \\`,
      `  -d '{"id":1,"jsonrpc":"2.0","method":"starknet_chainId","params":[]}' 2>/dev/null)" || body=""`,
      `chain="$([ "\${body##*$'\\n'}" = 200 ] && jq -ser '.[0].result' <<< "\${body%$'\\n'*}" 2>/dev/null)" || chain=""`,
      `if [ "\${chain,,}" != "0x534e5f4d41494e" ]; then`,
      '  echo "::error::The mainnet RPC is unavailable or not mainnet. CI does not fall back."; exit 1',
      "fi",
    ],
    failure: REFUSED_RPC,
  },
];

const PLAYWRIGHT_CONTROLS: readonly Control[] = [
  {
    lines: [
      'report="$RUNNER_TEMP/playwright-mainnet.json"',
      'echo "result=failed" >> "$GITHUB_OUTPUT"',
      "set +e",
      'PLAYWRIGHT_JSON_OUTPUT_FILE="$report" bun run test:e2e:mainnet --reporter=json >/dev/null 2>&1',
      "status=$?",
      "set -e",
    ],
    failure: "mainnet execution must run the Playwright mainnet config and withhold its output",
  },
  {
    lines: [
      `counts="$(jq -ser 'if length == 1 then .[0].stats else error("malformed") end | [.expected, .unexpected, .flaky, .skipped] | if all(type == "number" and . >= 0 and . <= 999999 and . == floor) then map(floor | tostring) | join(" ") else error("malformed") end' "$report" 2>/dev/null)" && [[ "$counts" =~ ^[0-9]{1,6}( [0-9]{1,6}){3}$ ]] || { echo "::error::Playwright mainnet report is malformed."; exit 1; }; read -r expected unexpected flaky skipped <<< "$counts"`,
      'rm -f "$report"',
      'echo "Playwright mainnet: exit $status, passed $expected, failed $unexpected, flaky $flaky, skipped $skipped."',
    ],
    failure: "mainnet execution must fail on a malformed Playwright report",
  },
  {
    lines: [
      'if [ "$expected" -eq 0 ]; then',
      '  echo "::error::Playwright mainnet executed no passing test."; exit 1',
      "fi",
    ],
    failure: "mainnet execution must fail when Playwright executed no test",
  },
  {
    lines: [
      'if [ "$status" -ne 0 ] || [ "$unexpected" -ne 0 ] || [ "$flaky" -ne 0 ]; then',
      '  echo "::error::Playwright mainnet failed. Output is withheld in CI; rerun locally for details."; exit 1',
      "fi",
      'echo "result=passed" >> "$GITHUB_OUTPUT"',
    ],
    failure: "mainnet execution must fail when a Playwright test fails or is flaky",
  },
];

const GASLESS_FAILED = "mainnet execution must fail unless the gasless send succeeded";

const GASLESS_CONTROLS: readonly Control[] = [
  {
    lines: [
      'log="$RUNNER_TEMP/gasless-mainnet.log"',
      'echo "result=failed" >> "$GITHUB_OUTPUT"',
      "set +e",
      'bun run test:mainnet >"$log" 2>&1',
      "status=$?",
      "set -e",
      "available=0 succeeded=0 skipped=0",
      'grep -Fxq "paymaster_isAvailable: true" "$log" && available=1',
      "grep -Eq '^Success\\. Fee [0-9]+ ' \"$log\" && succeeded=1",
      'grep -Fq "Skipping gasless mainnet test" "$log" && skipped=1',
      'rm -f "$log"',
      'echo "Gasless mainnet: exit $status, paymaster available $available, sent $succeeded, skipped $skipped."',
    ],
    failure: "mainnet execution must run the gasless mainnet script and withhold its output",
  },
  {
    lines: [
      'if [ "$status" -ne 0 ] || [ "$available" -ne 1 ] || [ "$succeeded" -ne 1 ] || [ "$skipped" -ne 0 ]; then',
      '  echo "::error::Gasless mainnet failed. Output is withheld in CI; rerun locally for details."; exit 1',
      "fi",
      'echo "result=passed" >> "$GITHUB_OUTPUT"',
    ],
    failure: GASLESS_FAILED,
  },
];

const LIVE_SUITE = {
  BRAMBLE_MAINNET_E2E_CI: "1",
  BRAMBLE_MAINNET_E2E_ENVIRONMENT: "mainnet-e2e",
  GASLESS_E2E_ADDRESS: ADDRESS,
  GASLESS_E2E_PRIVATE_KEY: KEY,
  GASLESS_E2E_RPC_URL: RPC,
  GASLESS_E2E_NETWORK: "mainnet",
} as const;

const STRK20_TIER = expression("vars.MAINNET_E2E_STRK20 == 'true' && 'strk20' || 'standard'");

/** The `execute` job's steps, in order. */
export const EXECUTE_STEPS: readonly StepShape[] = [
  { fields: SETUP_BUN, failure: EXECUTE_ORDER },
  { fields: SETUP_NODE, failure: EXECUTE_ORDER },
  {
    fields: {
      uses: "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333",
      with: { name: "mainnet-e2e-bundle", path: `${expression("runner.temp")}/bundle` },
    },
    failure: BUNDLE_FAILURE,
  },
  {
    fields: {
      name: "Unpack the build",
      env: { BUNDLE_SHA256: expression("needs.build.outputs.bundle_sha256") },
    },
    controls: [
      {
        lines: [
          'bundle="$RUNNER_TEMP/bundle/mainnet-e2e-bundle.tar"',
          'echo "$BUNDLE_SHA256  $bundle" | sha256sum -c --quiet',
          'tar -xf "$bundle" -C "$GITHUB_WORKSPACE"',
        ],
        failure: BUNDLE_FAILURE,
      },
    ],
    failure: BUNDLE_FAILURE,
  },
  {
    fields: {
      name: "Check and mask mainnet secrets",
      id: "secrets",
      env: {
        MAINNET_E2E_ADDRESS: ADDRESS,
        MAINNET_E2E_PRIVATE_KEY: KEY,
        MAINNET_E2E_RPC_URL: RPC,
        MAINNET_E2E_DISCOVERY_URL: DISCOVERY,
        MAINNET_E2E_PROVER_URL: PROVER,
        MAINNET_E2E_STRK20: expression("vars.MAINNET_E2E_STRK20 == 'true' && 'true' || 'false'"),
        PREFLIGHT_RPC_SHA256: expression("needs.preflight.outputs.rpc_sha256"),
      },
    },
    controls: SECRETS_CONTROLS,
    failure: SECRETS_STEP_FAILURE,
  },
  {
    fields: {
      name: "Playwright mainnet",
      id: "playwright",
      if: "vars.MAINNET_E2E_STRK20 == 'true'",
      env: {
        ...LIVE_SUITE,
        MAINNET_E2E_SPEND_TIER: "strk20",
        BRAMBLE_MAINNET_E2E_ADDRESS: ADDRESS,
        BRAMBLE_MAINNET_E2E_PRIVATE_KEY: KEY,
        BRAMBLE_MAINNET_E2E_RPC_URL: RPC,
        BRAMBLE_STRK20_E2E_CI: "1",
        BRAMBLE_STRK20_E2E_ACCOUNT_ADDRESS: ADDRESS,
        BRAMBLE_STRK20_E2E_PRIVATE_KEY: KEY,
        BRAMBLE_STRK20_E2E_RPC_URL: RPC,
        BRAMBLE_STRK20_E2E_DISCOVERY_URL: DISCOVERY,
        BRAMBLE_STRK20_E2E_PROVER_URL: PROVER,
        BRAMBLE_STRK20_E2E_DEPOSIT_STRK: "0.05",
        BRAMBLE_STRK20_E2E_MAINNET_ACK: "I_UNDERSTAND_THIS_WRITES_TO_MAINNET",
        BRAMBLE_STRK20_E2E_PUBLIC_CALLER_ACK: "I_UNDERSTAND_THIS_LINKS_PRIVATE_ACTIONS",
      },
    },
    controls: PLAYWRIGHT_CONTROLS,
    failure: "mainnet execution must run the reviewed Playwright mainnet step",
  },
  {
    fields: {
      name: "Gasless mainnet",
      id: "gasless",
      if: "steps.secrets.outcome == 'success' && steps.playwright.outcome != 'failure'",
      env: { ...LIVE_SUITE, MAINNET_E2E_SPEND_TIER: STRK20_TIER },
    },
    controls: GASLESS_CONTROLS,
    failure: GASLESS_FAILED,
  },
  {
    fields: {
      name: "Require the gasless send",
      if: "always()",
      env: { GASLESS: expression("steps.gasless.outputs.result") },
      run: script([
        '[ "$GASLESS" = passed ] || { echo "::error::The gasless mainnet send did not pass."; exit 1; }',
      ]),
    },
    failure: GUARD,
  },
];
