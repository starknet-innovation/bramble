/**
 * The Mainnet E2E Slack notifier: the one step of the `notify` job.
 *
 * It reports every run the gate enabled, pass or fail, to a Slack incoming
 * webhook. The webhook URL is the environment secret
 * `SLACK_MAINNET_E2E_WEBHOOK_URL` in the `mainnet-e2e-slack` environment,
 * bound only in this step's `env` (see `mainnet-e2e-workflow-secrets.ts`).
 * The job runs on a hosted runner with no token permission, no checkout, no
 * install and no repository code: one pinned `github-script` whose body is
 * compared whole. An empty webhook means Slack is not configured and only
 * emits a notice; a non-Slack URL fails the job, and a delivery failure is a
 * warning that leaves the run result unchanged.
 *
 * The message carries only values the script validates against fixed
 * allowlists or the reporter's regexes: job results, the Playwright and
 * gasless outcomes, the balance verdict, STRK and USDC spent, the short
 * commit and the run URL. No test output, RPC URL or secret reaches it, and
 * the payload is built with `JSON.stringify`, never by shell interpolation.
 */
import { type StepShape, script } from "./mainnet-e2e-workflow-shape";

const expression = (body: string): string => `\${{ ${body} }}`;

/** The webhook secret's name, which is also its step env variable. */
export const SLACK_WEBHOOK_SECRET = "SLACK_MAINNET_E2E_WEBHOOK_URL";

/** The GitHub environment that holds {@link SLACK_WEBHOOK_SECRET}. */
export const SLACK_ENVIRONMENT = "mainnet-e2e-slack";

/** The notifier's `github-script` body, line by line. */
export const NOTIFY_SCRIPT: readonly string[] = [
  `const env = process.env;`,
  `const webhook = env.SLACK_MAINNET_E2E_WEBHOOK_URL || "";`,
  `if (webhook === "") return core.notice("Slack is not configured: set SLACK_MAINNET_E2E_WEBHOOK_URL in the mainnet-e2e-slack environment.");`,
  `core.setSecret(webhook);`,
  `if (!/^https:\\/\\/hooks\\.slack\\.com\\/services\\/[A-Za-z0-9_\\/-]+$/.test(webhook)) return core.setFailed("SLACK_MAINNET_E2E_WEBHOOK_URL must be a https://hooks.slack.com/services/ URL.");`,
  `const result = (value) => ["success", "failure", "cancelled", "skipped"].includes(value) ? value : "unavailable";`,
  `const outcome = (value) => value === "passed" || value === "failed" ? value : "not run";`,
  `const amount = (value) => /^-?[0-9]{1,12}(\\.[0-9]{1,18})?$/.test(value || "") ? value : "unavailable";`,
  `const verdict = ["ok", "above-maximum", "below-minimum", "over-cap"].includes(env.VERDICT) ? env.VERDICT : "unavailable";`,
  `const revision = /^[0-9a-f]{40}$/.test(env.REVISION || "") ? env.REVISION.slice(0, 7) : "unavailable";`,
  `const results = (env.RESULTS || "").split(" ");`,
  `const jobs = ["preflight", "build", "tests", "post-run balance"].map((name, index) => [name, result(results.length === 4 ? results[index] : "")]);`,
  `const passed = jobs.every(([, value]) => value === "success") && verdict === "ok";`,
  `const text = [`,
  `  \`Mainnet E2E \${passed ? "pass" : "FAIL"} on main at \\\`\${revision}\\\`\`,`,
  `  \`Jobs: \${jobs.map(([name, value]) => \`\${name} \${value}\`).join(", ")}\`,`,
  `  \`Playwright \${outcome(env.PLAYWRIGHT)}, gasless \${outcome(env.GASLESS)}\`,`,
  `  \`Balance \${verdict}. Spent \${amount(env.STRK_DELTA)} STRK, \${amount(env.USDC_DELTA)} USDC.\`,`,
  `  \`<\${env.GITHUB_SERVER_URL}/\${env.GITHUB_REPOSITORY}/actions/runs/\${env.GITHUB_RUN_ID}|View run>\`,`,
  `].join("\\n");`,
  `const request = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, unfurl_links: false }), redirect: "error", signal: AbortSignal.timeout(20000) };`,
  `const status = await fetch(webhook, request).then((response) => response.status, () => 0);`,
  `if (status >= 200 && status < 300) core.info("Posted the mainnet E2E result to Slack.");`,
  `else core.warning(\`Slack did not accept the mainnet E2E result (HTTP \${status}); the run result is unchanged.\`);`,
];

/** Reported when the notifier step is missing or differs from its reviewed shape. */
export const NOTIFY_FAILURE =
  "the hosted mainnet Slack notifier must post only validated results, with the Slack webhook as its only secret";

const result = (job: string): string => expression(`needs.${job}.result`);

/** The `notify` job's reviewed steps: exactly one pinned `github-script`. */
export const NOTIFY_STEPS: readonly StepShape[] = [
  {
    fields: {
      name: "Post the result to Slack",
      id: "slack",
      uses: "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
      env: {
        [SLACK_WEBHOOK_SECRET]: expression(`secrets.${SLACK_WEBHOOK_SECRET}`),
        REVISION: expression("needs.resolve.outputs.revision"),
        RESULTS: ["preflight", "build", "execute", "post"].map(result).join(" "),
        PLAYWRIGHT: expression("needs.execute.outputs.playwright"),
        GASLESS: expression("needs.execute.outputs.gasless"),
        VERDICT: expression("needs.post.outputs.verdict || needs.preflight.outputs.verdict"),
        STRK_DELTA: expression("needs.post.outputs.strk_delta"),
        USDC_DELTA: expression("needs.post.outputs.usdc_delta"),
      },
      with: { script: script(NOTIFY_SCRIPT) },
    },
    failure: NOTIFY_FAILURE,
  },
];
