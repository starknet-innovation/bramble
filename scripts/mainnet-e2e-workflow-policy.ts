/**
 * Trust boundary for the live mainnet E2E workflow.
 *
 * The workflow holds a funded hot-wallet key and runs on the self-hosted
 * runner, so it is a reviewed policy rather than a baseline workflow. The
 * checks are textual on purpose: each one is a control a diff can drop.
 * Parsing is left to the website-deploy policy, which already fails closed
 * when any workflow is not YAML.
 */

import { forbidText, jobBody, requireText, workflowPath } from "./workflow-policy-text";

const GITHUB_EXPRESSION = "$" + "{{";
const HOT_WALLET_KEY = "secrets.MAINNET_E2E_PRIVATE_KEY";
const HOT_WALLET_BINDINGS = 5;

const keyBindings = (source: string): readonly string[] =>
  source.split("\n").filter((line) => line.includes(HOT_WALLET_KEY));

/**
 * Violations of the mainnet E2E workflow's reviewed controls. `source` is the
 * workflow text. The function does not read the filesystem.
 */
export const mainnetE2eWorkflowFailures = (source: string): string[] => {
  const failures: string[] = [];
  const path = workflowPath("mainnet-e2e.yml");
  const execute = jobBody(source, "execute");
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
  requireText(
    failures,
    source,
    "ready=false",
    `${path} must skip when the hot-wallet secrets are unset`,
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
    execute,
    "\n          ref:",
    "self-hosted mainnet execution must not pass configured refs to checkout",
  );
  requireText(
    failures,
    execute,
    "persist-credentials: false",
    "self-hosted mainnet execution must not leave the checkout token in .git/config",
  );
  requireText(
    failures,
    execute,
    `REVISION: ${GITHUB_EXPRESSION} needs.resolve.outputs.revision }}`,
    "mainnet execution must consume the resolved immutable commit",
  );
  requireText(
    failures,
    execute,
    '[[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]',
    "mainnet execution must validate the resolved immutable commit",
  );
  requireText(
    failures,
    execute,
    'git checkout --detach "$REVISION"',
    "mainnet execution must detach onto the resolved immutable commit",
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
    "timeout-minutes: 180",
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
  forbidText(
    failures,
    source,
    "actions/upload-artifact",
    `${path} must not upload artifacts that could contain the hot-wallet key`,
  );

  const bindings = keyBindings(source);
  if (bindings.length !== HOT_WALLET_BINDINGS) {
    failures.push(
      `${path} must bind the hot-wallet private key in exactly ${HOT_WALLET_BINDINGS} step env values`,
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
