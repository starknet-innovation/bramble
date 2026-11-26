/**
 * Mutations of the Mainnet E2E Slack notifier (`notify` job), item 11 of
 * `FAIL_WITHOUT` in `mainnet-e2e-policy-mutations.ts`. Each widens what the
 * notifier runs, holds or sends, or narrows when it reports, and must fail
 * with the named failure.
 */
import type { Weakening } from "./mainnet-e2e-policy-mutations";

const E = "$" + "{{";
const PATH = ".github/workflows/mainnet-e2e.yml";
const NOTIFY_ORDER =
  "the hosted mainnet Slack notifier must run only its reviewed step: no checkout, install or repository code";
const NOTIFY_STEP =
  "the hosted mainnet Slack notifier must post only validated results, with the Slack webhook as its only secret";
const SLACK_PLACE = `${PATH} must bind the Slack webhook only in the notify step env`;

/** Weakenings of the Slack notifier, all item `11 notify`. */
export const NOTIFY_WEAKENINGS: readonly Weakening[] = [
  {
    item: "11 notify",
    label: "notifier checks out and installs before posting",
    search: "      - name: Post the result to Slack\n",
    replacement:
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        with:\n          persist-credentials: false\n      - run: bun install --frozen-lockfile\n      - name: Post the result to Slack\n",
    failure: NOTIFY_ORDER,
  },
  {
    item: "11 notify",
    label: "notifier env reads the RPC URL",
    search: `          REVISION: ${E} needs.resolve.outputs.revision }}\n          RESULTS:`,
    replacement: `          RPC: ${E} secrets.MAINNET_E2E_RPC_URL }}\n          REVISION: ${E} needs.resolve.outputs.revision }}\n          RESULTS:`,
    failure: "the hosted mainnet Slack notifier must receive only the Slack webhook",
  },
  {
    item: "11 notify",
    label: "Slack webhook handed to the issue reporter",
    search: "          TIER: ",
    replacement: `          HOOK: ${E} secrets.SLACK_MAINNET_E2E_WEBHOOK_URL }}\n          TIER: `,
    failure: SLACK_PLACE,
  },
  {
    item: "11 notify",
    label: "notifier gains an issue-write token",
    search: "    permissions: {}\n",
    replacement: "    permissions:\n      issues: write\n",
    failure: "the hosted mainnet Slack notifier must hold no token permission",
  },
  {
    item: "11 notify",
    label: "notifier only on failure, always() kept in a comment",
    search:
      "    if: always() && needs.gate.outputs.run == 'true'\n    environment:\n      name: mainnet-e2e-slack\n",
    replacement:
      "    if: failure() && needs.gate.outputs.run == 'true' # always()\n    environment:\n      name: mainnet-e2e-slack\n",
    failure: "the mainnet Slack notifier must report every run the gate enabled, pass or fail",
  },
  {
    item: "11 notify",
    label: "notifier moved to the self-hosted runner",
    search: "    timeout-minutes: 5\n    runs-on: ubuntu-latest\n",
    replacement: "    timeout-minutes: 5\n    runs-on: [self-hosted]\n",
    failure: "the mainnet Slack notifier must use a hosted runner",
  },
  {
    item: "11 notify",
    label: "notifier posts raw test output",
    search: "            const passed = ",
    replacement: '            jobs.push(["log", process.env.LOG]);\n            const passed = ',
    failure: NOTIFY_STEP,
  },
  {
    item: "11 notify",
    label: "notifier borrows the hot-wallet environment",
    search: "      name: mainnet-e2e-slack\n",
    replacement: "      name: mainnet-e2e\n",
    failure: "the notify job must use only its reviewed environment",
  },
];
