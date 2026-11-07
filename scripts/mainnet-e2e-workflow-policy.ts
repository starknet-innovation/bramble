/**
 * Trust boundary for the live mainnet E2E workflow.
 *
 * The workflow holds a funded hot-wallet key and runs on the self-hosted
 * runner, so it is a reviewed policy rather than a baseline workflow. The
 * checks are textual on purpose: each one is a control a diff can drop.
 *
 * Jobs split by trust. `build` runs release-controlled install and build with
 * no secret. `execute` holds the key and may not install, build, check out,
 * or print raw test output. `preflight` and `post` run trusted `main` code
 * without the key or the release commit, and pass the spend baseline as a
 * job output the code under test cannot write. `execute` uses exactly the RPC
 * preflight validated: it compares a SHA-256 job output, re-checks HTTPS, the
 * shared hosts and the mainnet chain id, and never falls back.
 * Parsing is left to the website-deploy policy, which already fails closed
 * when any workflow is not YAML.
 */

import { mainnetE2eDocumentFailures } from "./mainnet-e2e-workflow-document";
import { forbidText, jobBody, requireText, workflowPath } from "./workflow-policy-text";

const GITHUB_EXPRESSION = "$" + "{{";
const HOT_WALLET_KEY = "secrets.MAINNET_E2E_PRIVATE_KEY";
const HOT_WALLET_BINDINGS = 5;

const keyBindings = (source: string): readonly string[] =>
  source.split("\n").filter((line) => line.includes(HOT_WALLET_KEY));

const occurrences = (source: string, text: string): number => source.split(text).length - 1;

/** Release-controlled steps that must not share a runner with the key. */
const UNTRUSTED_SETUP = [
  "bun install",
  "bun run build",
  "vendor:argent",
  "vendor:privacy",
  "test:e2e:install",
  "actions/checkout@",
  "git checkout",
] as const;

/**
 * Violations of the mainnet E2E workflow's reviewed controls. `source` is the
 * workflow text. The function does not read the filesystem.
 */
export const mainnetE2eWorkflowFailures = (source: string): string[] => {
  const failures: string[] = [];
  const path = workflowPath("mainnet-e2e.yml");
  const execute = jobBody(source, "execute");
  const build = jobBody(source, "build");
  const preflight = jobBody(source, "preflight");
  const post = jobBody(source, "post");
  const report = jobBody(source, "report");

  for (const trigger of [
    "\n  pull_request:",
    "\n  pull_request_target:",
    "\n  push:",
    "\n  workflow_run:",
    "\n  workflow_call:",
  ]) {
    forbidText(failures, source, trigger, `${path} must not trigger on ${trigger.trim()}`);
  }
  requireText(
    failures,
    source,
    'cron: "0 6 * * *"',
    `${path} must schedule at 06:00 UTC, offset from nightly`,
  );
  forbidText(
    failures,
    source,
    'cron: "0 3 * * *"',
    `${path} must not share nightly's 03:00 UTC schedule`,
  );
  requireText(
    failures,
    source,
    "group: mainnet-e2e\n  cancel-in-progress: false",
    `${path} must queue on mainnet-e2e and must not cancel an in-flight run`,
  );
  requireText(
    failures,
    source,
    '[ "$EVENT_NAME" = "workflow_dispatch" ] && [ "$TRIGGER_REF" != "refs/heads/main" ]',
    `${path} manual dispatches must reject workflow revisions outside main`,
  );
  requireText(
    failures,
    source,
    '[[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+(\\.[0-9]+)?$ ]]',
    `${path} must constrain configured refs to canonical release branches`,
  );
  requireText(
    failures,
    source,
    'grep -Fxq -- "$candidate"',
    `${path} must require the exact configured branch to exist in the base repository`,
  );
  requireText(
    failures,
    source,
    `revision="$(gh api "repos/$GITHUB_REPOSITORY/commits/$encoded_candidate" --jq '.sha')"`,
    `${path} must resolve the selected branch to an immutable commit`,
  );
  requireText(
    failures,
    source,
    "github.repository == 'starknet-innovation/bramble'",
    `${path} must refuse repositories other than starknet-innovation/bramble`,
  );
  requireText(
    failures,
    source,
    "github.event.repository.fork != true",
    `${path} must refuse forks`,
  );
  requireText(
    failures,
    source,
    "vars.MAINNET_E2E_CONFIGURED",
    `${path} must skip until maintainers set vars.MAINNET_E2E_CONFIGURED`,
  );
  forbidText(
    failures,
    source,
    "ready=false",
    `${path} must fail, not skip green, when it is enabled without its secrets`,
  );
  requireText(
    failures,
    execute,
    `if [ "\${#missing[@]}" -ne 0 ]; then`,
    "mainnet execution must fail when any hot-wallet secret is missing",
  );

  requireText(
    failures,
    execute,
    "permissions:\n      contents: read",
    "self-hosted mainnet execution must declare read-only repository permission",
  );
  forbidText(
    failures,
    execute,
    "issues: write",
    "self-hosted mainnet execution must not receive issue write permission",
  );
  forbidText(
    failures,
    source,
    "\n          ref:",
    `${path} must not pass configured refs to checkout`,
  );
  if (
    occurrences(source, "actions/checkout@") !== occurrences(source, "persist-credentials: false")
  ) {
    failures.push(`${path} must not leave a checkout token in .git/config`);
  }
  requireText(
    failures,
    build,
    `REVISION: ${GITHUB_EXPRESSION} needs.resolve.outputs.revision }}`,
    "the mainnet build must consume the resolved immutable commit",
  );
  requireText(
    failures,
    build,
    '[[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]',
    "the mainnet build must validate the resolved immutable commit",
  );
  requireText(
    failures,
    build,
    'git checkout --detach "$REVISION"',
    "the mainnet build must detach onto the resolved immutable commit",
  );
  for (const forbidden of ["secrets.", "environment:"]) {
    forbidText(
      failures,
      build,
      forbidden,
      "the mainnet build runs release code and must not receive any secret",
    );
  }
  for (const setup of UNTRUSTED_SETUP) {
    forbidText(
      failures,
      execute,
      setup,
      `mainnet execution must not run ${setup}; install and build in the keyless build job`,
    );
  }
  requireText(
    failures,
    execute,
    "| sha256sum -c --quiet",
    "mainnet execution must verify the build bundle it runs",
  );
  for (const printer of ['cat "', "tee ", "--reporter=list", "--reporter=line"]) {
    forbidText(
      failures,
      execute,
      printer,
      "mainnet execution must not print raw test output; report counts only",
    );
  }
  requireText(
    failures,
    execute,
    `jq -ser 'if length == 1 then .[0].stats else error("malformed") end | [.expected, .unexpected, .flaky, .skipped] | if all(type == "number" and . >= 0 and . <= 999999 and . == floor) then map(floor | tostring) | join(" ") else error("malformed") end' "$report" 2>/dev/null)" && [[ "$counts" =~ ^[0-9]{1,6}( [0-9]{1,6}){3}$ ]] || { echo "::error::Playwright mainnet report is malformed."; exit 1; }`,
    "mainnet execution must fail on a malformed Playwright report",
  );
  // Each check keeps its `exit 1`; without it the step reports passed.
  requireText(
    failures,
    execute,
    'if [ "$expected" -eq 0 ]; then\n            echo "::error::Playwright mainnet executed no passing test."; exit 1\n          fi',
    "mainnet execution must fail when Playwright executed no test",
  );
  requireText(
    failures,
    execute,
    'if [ "$status" -ne 0 ] || [ "$unexpected" -ne 0 ] || [ "$flaky" -ne 0 ]; then\n            echo "::error::Playwright mainnet failed. Output is withheld in CI; rerun locally for details."; exit 1\n          fi',
    "mainnet execution must fail when a Playwright test fails or is flaky",
  );
  requireText(
    failures,
    execute,
    'if [ "$status" -ne 0 ] || [ "$available" -ne 1 ] || [ "$succeeded" -ne 1 ] || [ "$skipped" -ne 0 ]; then\n            echo "::error::Gasless mainnet failed. Output is withheld in CI; rerun locally for details."; exit 1\n          fi',
    "mainnet execution must fail unless the gasless send succeeded",
  );
  for (const [name, job] of [
    ["preflight", preflight],
    ["post", post],
  ] as const) {
    for (const forbidden of [HOT_WALLET_KEY, "git checkout", "download-artifact"]) {
      forbidText(
        failures,
        job,
        forbidden,
        `the ${name} balance check must run trusted main code without the key`,
      );
    }
    requireText(
      failures,
      job,
      "environment:\n      name: mainnet-e2e-balance",
      `the ${name} balance check must use the read-only mainnet-e2e-balance environment`,
    );
    requireText(
      failures,
      job,
      "runs-on: ubuntu-latest",
      `the ${name} balance check must run on a hosted runner, apart from the tests`,
    );
  }
  requireText(
    failures,
    post,
    `MAINNET_E2E_STRK_BEFORE_RAW: ${GITHUB_EXPRESSION} needs.preflight.outputs.strk_before_raw }}`,
    "the post-run check must take its baseline from the preflight job output",
  );
  requireText(
    failures,
    execute,
    "environment:\n      name: mainnet-e2e",
    "mainnet execution must read secrets from the mainnet-e2e environment",
  );
  requireText(
    failures,
    execute,
    `codebuild-gha-runner-mc-wallet-${GITHUB_EXPRESSION} github.run_id }}-${GITHUB_EXPRESSION} github.run_attempt }}`,
    "mainnet execution must use the existing CodeBuild runner",
  );
  requireText(
    failures,
    execute,
    "timeout-minutes: 120",
    "mainnet execution must time out so a stuck run releases the nonce lock",
  );
  requireText(
    failures,
    execute,
    'BRAMBLE_MAINNET_E2E_CI: "1"',
    "mainnet execution must set the CI opt-in for the live suite",
  );
  requireText(
    failures,
    execute,
    "bun run test:e2e:mainnet",
    "mainnet execution must run the Playwright mainnet config",
  );
  requireText(
    failures,
    execute,
    "bun run test:mainnet",
    "mainnet execution must run the gasless mainnet script",
  );
  requireText(
    failures,
    execute,
    "::add-mask::",
    "mainnet execution must mask the hot-wallet secrets",
  );
  requireText(
    failures,
    preflight,
    `rpc_sha256: ${GITHUB_EXPRESSION} steps.balance.outputs.rpc_sha256 }}`,
    "the preflight must publish the hash of the RPC it validated",
  );
  for (const control of [
    `PREFLIGHT_RPC_SHA256: ${GITHUB_EXPRESSION} needs.preflight.outputs.rpc_sha256 }}`,
    '[ "$actual" != "$PREFLIGHT_RPC_SHA256" ]; then\n            echo "::error::The mainnet-e2e RPC is not the one preflight validated."; exit 1\n          fi',
  ]) {
    // Each refusal must keep its `exit 1`, or the step would only warn.
    requireText(
      failures,
      execute,
      control,
      "mainnet execution must use exactly the RPC preflight validated",
    );
  }
  for (const control of [
    '[[ "$MAINNET_E2E_RPC_URL" == https://* ]] || { echo "::error::The mainnet RPC must be HTTPS."; exit 1; }',
    "--proto '=https'",
    'case "${host,,}" in wallet.nodes.starknet.org|mainnet.nodes.starknet.org) echo "::error::The mainnet RPC must be a dedicated test endpoint."; exit 1 ;; esac',
    'if [ "${chain,,}" != "0x534e5f4d41494e" ]; then\n            echo "::error::The mainnet RPC is unavailable or not mainnet. CI does not fall back."; exit 1\n          fi',
  ]) {
    requireText(
      failures,
      execute,
      control,
      "mainnet execution must refuse a non-HTTPS, shared, unavailable or non-mainnet RPC",
    );
  }
  const rpcCheck = execute.indexOf('if [ "${chain,,}" != "0x534e5f4d41494e" ]; then');
  const firstTest = execute.indexOf("      - name: Playwright mainnet");
  const secretsStep = execute.indexOf("        id: secrets\n");
  if (
    secretsStep < 0 ||
    rpcCheck < 0 ||
    firstTest < 0 ||
    !(secretsStep < rpcCheck && rpcCheck < firstTest)
  ) {
    failures.push("mainnet execution must check the RPC in the secrets step, before any live test");
  }
  requireText(
    failures,
    execute,
    "      - name: Check and mask mainnet secrets\n        id: secrets\n",
    "mainnet execution must keep the secrets step id that later steps depend on",
  );
  // The gasless condition and the execute job's own `if:` are read from the
  // parsed document: a text match can survive a YAML continuation line.
  failures.push(...mainnetE2eDocumentFailures(source));
  // The last step: execute is green only when the gasless send passed.
  const guard = `      - name: Require the gasless send
        if: always()
        env: { GASLESS: "${GITHUB_EXPRESSION} steps.gasless.outputs.result }}" }
        run: '[ "$GASLESS" = passed ] || { echo "::error::The gasless mainnet send did not pass."; exit 1; }'
`;
  if (!execute.trimEnd().endsWith(guard.trimEnd())) {
    failures.push("mainnet execution must end by requiring a passed gasless send");
  }
  if (
    occurrences(source, "actions/upload-artifact") !== occurrences(build, "actions/upload-artifact")
  ) {
    failures.push(`${path} may upload artifacts only from the keyless build job`);
  }

  const bindings = keyBindings(source);
  if (bindings.length !== HOT_WALLET_BINDINGS || keyBindings(execute).length !== bindings.length) {
    failures.push(
      `${path} must bind the hot-wallet private key in exactly ${HOT_WALLET_BINDINGS} step env values, all in execute`,
    );
  }
  for (const line of bindings) {
    if (!/^ {10}\S+: \$\{\{ secrets\.MAINNET_E2E_PRIVATE_KEY \}\}$/.test(line)) {
      failures.push(`${path} must bind the hot-wallet private key only as a step env value`);
    }
  }

  requireText(
    failures,
    report,
    "runs-on: ubuntu-latest",
    "mainnet issue reporting must use a hosted runner",
  );
  requireText(
    failures,
    report,
    "issues: write",
    "the hosted mainnet reporter must declare its narrow issue permission",
  );
  forbidText(
    failures,
    report,
    "actions/checkout@",
    "the hosted mainnet reporter must not check out or execute release-branch source",
  );
  forbidText(
    failures,
    report,
    "secrets.",
    "the hosted mainnet reporter must not receive mainnet secrets",
  );
  return failures;
};
