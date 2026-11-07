/**
 * Exact text of the Mainnet E2E workflow's display-only scripts: the post-run
 * summary and the hosted reporter's `github-script` body.
 *
 * Neither runs beside the key, and neither can read a secret (the secret scan
 * covers every decoded string). They are still pinned whole, so no command or
 * API call can be added to a job that holds an environment or an issue-write
 * token without a reviewed change to this file.
 */

/** The manual dispatch input's description, shown in the Actions UI. */
export const BRANCH_INPUT_DESCRIPTION = `Override the release branch to run against (e.g. release/v0.10.9). Blank = auto-resolve.`;

/** The post job's summary step, line by line. */
export const SUMMARY_SCRIPT: readonly string[] = [
  `set -euo pipefail`,
  `{`,
  `  echo "## Mainnet E2E — \\\`$BRANCH\\\`"`,
  `  echo "Commit \\\`$REVISION\\\`. Account \\\`$ADDRESS\\\`. Balance verdict \\\`\${VERDICT:-unavailable}\\\`."`,
  `  echo "| Token | Before | After | Spent |"`,
  `  echo "| --- | --- | --- | --- |"`,
  `  echo "| STRK | $STRK |"`,
  `  echo "| USDC | $USDC |"`,
  `  echo "- Build (no secrets): $BUILD"`,
  `  echo "- Live tests: $EXECUTE (Playwright $PLAYWRIGHT, gasless $GASLESS)"`,
  `} >> "$GITHUB_STEP_SUMMARY"`,
];

/** The reporter's `github-script` body, line by line. */
export const REPORT_SCRIPT: readonly string[] = [
  `const { owner, repo } = context.repo;`,
  `const branch = process.env.BRANCH || "unknown";`,
  `const amount = (value) => /^-?[0-9]{1,12}(\\.[0-9]{1,18})?$/.test(value || "") ? value : "unavailable";`,
  `const felt = (value) => /^0x[0-9a-fA-F]{1,64}$/.test(value || "") ? value : "unavailable";`,
  `const verdicts = ["ok", "above-maximum", "below-minimum", "over-cap", "unavailable"];`,
  `const verdict = verdicts.includes(process.env.VERDICT) ? process.env.VERDICT : "unavailable";`,
  `const tier = process.env.TIER === "strk20" || process.env.TIER === "standard" ? process.env.TIER : "unavailable";`,
  `const revision = /^[0-9a-f]{40}$/.test(process.env.REVISION || "") ? process.env.REVISION : "unavailable";`,
  `const title = \`Mainnet E2E: \${branch} — failing checks\`;`,
  `const runUrl = \`\${process.env.GITHUB_SERVER_URL}/\${process.env.GITHUB_REPOSITORY}/actions/runs/\${process.env.GITHUB_RUN_ID}\`;`,
  `const body = [`,
  `  \`Automated mainnet E2E run for \\\`\${branch}\\\` failed or the hot wallet is outside its spend policy.\`,`,
  `  "",`,
  `  \`**Run:** \${runUrl}\`,`,
  `  \`**Commit:** \\\`\${revision}\\\`\`,`,
  `  \`**Spend tier:** \\\`\${tier}\\\`\`,`,
  `  \`**Balance verdict:** \\\`\${verdict}\\\`\`,`,
  `  \`**Account:** \\\`\${felt(process.env.ADDRESS)}\\\`\`,`,
  `  \`**Jobs:** \${/^[a-z ,-]+$/.test(process.env.JOBS || "") ? process.env.JOBS : "unavailable"}\`,`,
  `  \`**Last updated:** \${new Date().toISOString()}\`,`,
  `  "",`,
  `  "| Token | Before | After | Spent |",`,
  `  "| --- | --- | --- | --- |",`,
  `  \`| STRK | \${amount(process.env.STRK_BEFORE)} | \${amount(process.env.STRK_AFTER)} | \${amount(process.env.STRK_DELTA)} |\`,`,
  `  \`| USDC | \${amount(process.env.USDC_BEFORE)} | \${amount(process.env.USDC_AFTER)} | \${amount(process.env.USDC_DELTA)} |\`,`,
  `  "",`,
  `  "below-minimum: fund the hot wallet. above-maximum: move the excess off. over-cap: this run spent more than the per-run cap.",`,
  `  "Upserted by .github/workflows/mainnet-e2e.yml. Close once the branch is green.",`,
  `].join("\\n");`,
  `const existingList = await github.paginate(github.rest.issues.listForRepo, {`,
  `  owner, repo, state: "open", labels: "ci-cd", per_page: 100,`,
  `});`,
  `const existing = existingList.find((item) => item.title === title && !item.pull_request);`,
  `if (existing) {`,
  `  await github.rest.issues.update({ owner, repo, issue_number: existing.number, body });`,
  `  core.info(\`Updated tracking issue #\${existing.number}.\`);`,
  `} else {`,
  `  const created = await github.rest.issues.create({`,
  `    owner, repo, title, body,`,
  `    labels: ["ci-cd", "release"],`,
  `  });`,
  `  core.info(\`Created tracking issue #\${created.data.number}.\`);`,
  `}`,
];
