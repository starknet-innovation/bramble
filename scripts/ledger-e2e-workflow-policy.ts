/**
 * Trust boundary for the Speculos Ledger E2E workflow (`ledger-e2e.yml`).
 *
 * The workflow runs pull-request code from forks, so its safety rests on what
 * it does not hold: no repository secret, a read-only token, and a disposable
 * GitHub-hosted runner. Its value rests on never passing vacuously: the suite
 * runs with BRAMBLE_SPECULOS_REQUIRED=1, unrecorded app hashes fail the run
 * before anything is built, and the hash-recording mode runs no test.
 *
 * Membership in the reviewed policies exempts a workflow from the baseline
 * runner and trigger rules, so this module restates them more strictly. What
 * GitHub executes is checked on the parsed document
 * (`ledger-e2e-workflow-document.ts`); the textual checks here name each
 * control a diff can drop, so a failure says which one went.
 */
import { ledgerE2eDocumentFailures } from "./ledger-e2e-workflow-document";
import { actionReferences, isPinnedActionReference } from "./workflow-inventory";
import { forbidText, jobBody, requireText, workflowPath } from "./workflow-policy-text";

/** File name of the Speculos Ledger E2E workflow. */
export const LEDGER_E2E_WORKFLOW = "ledger-e2e.yml";

const GITHUB_EXPRESSION = "$" + "{{";
const SUITE_STEP = "        run: BRAMBLE_SPECULOS_REQUIRED=1 bun run test:e2e:ledger";
const ARTIFACT_STEP = `      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        if: failure()
        with:
          name: ledger-e2e-traces
          path: test-results/
          retention-days: 7
          if-no-files-found: ignore
`;

const occurrences = (source: string, text: string): number => source.split(text).length - 1;

const sourceLines = (source: string): string[] =>
  source.split("\n").filter((line) => !line.trimStart().startsWith("#"));

const credentialFailures = (source: string, path: string): string[] => {
  const failures: string[] = [];
  forbidText(failures, source, "write-all", `${path} must not request write permissions`);
  if (sourceLines(source).some((line) => /:\s*write\b/.test(line))) {
    failures.push(`${path} must not request write permissions`);
  }
  if (/self-hosted|codebuild/i.test(source)) {
    failures.push(`${path} must not name a self-hosted runner`);
  }
  for (const trigger of ["pull_request_target", "workflow_run", "workflow_call"]) {
    forbidText(failures, source, trigger, `${path} must not trigger on ${trigger}`);
  }
  for (const { line, reference } of actionReferences(source)) {
    if (!isPinnedActionReference(reference)) {
      failures.push(`${path} line ${line} must pin its action to a commit SHA`);
    }
  }
  return failures;
};

const modeFailures = (source: string, path: string): string[] => {
  const failures: string[] = [];
  const speculos = jobBody(source, "speculos");
  const record = jobBody(source, "record-hashes");
  requireText(
    failures,
    speculos,
    `    if: ${GITHUB_EXPRESSION} !inputs.record_hashes }}\n`,
    `${path} must skip the test job in record mode`,
  );
  requireText(
    failures,
    speculos,
    "        run: bun run scripts/ledger-app-hashes.ts require nanosp flex\n",
    `${path} must fail while the Ledger app hashes are unrecorded`,
  );
  requireText(
    failures,
    speculos,
    `${SUITE_STEP}\n`,
    `${path} must run the suite with BRAMBLE_SPECULOS_REQUIRED=1`,
  );
  const suiteLines = sourceLines(source).filter((line) =>
    /test:e2e:ledger|BRAMBLE_SPECULOS_REQUIRED/.test(line),
  );
  if (suiteLines.some((line) => line !== SUITE_STEP)) {
    failures.push(`${path} must run the suite only as \`${SUITE_STEP.trim()}\``);
  }
  forbidText(failures, source, "continue-on-error", `${path} must not tolerate a failed step`);
  requireText(
    failures,
    record,
    "    if: github.event_name == 'workflow_dispatch' && inputs.record_hashes\n",
    `${path} must run record mode only on a dispatch that asks for it`,
  );
  requireText(
    failures,
    record,
    `        shell: bash\n        run: bun run scripts/ledger-app-hashes.ts record | tee -a "$GITHUB_STEP_SUMMARY"\n`,
    `${path} must report the recorded hashes and fail when one is missing`,
  );
  forbidText(failures, record, "test:e2e", `${path} record mode must not run tests`);
  if (occurrences(source, "actions/upload-artifact@") !== 1) {
    failures.push(`${path} must upload one artifact, the failure traces`);
  }
  requireText(
    failures,
    speculos,
    ARTIFACT_STEP,
    `${path} must upload only Playwright output, only on failure, kept 7 days`,
  );
  return failures;
};

/**
 * Violations of the Ledger E2E workflow's reviewed controls. Pure: it reads
 * only the text it is given, so tests can mutate one control at a time.
 */
export const ledgerE2eWorkflowFailures = (source: string): string[] => {
  const path = workflowPath(LEDGER_E2E_WORKFLOW);
  return [
    ...ledgerE2eDocumentFailures(source, path),
    ...credentialFailures(source, path),
    ...modeFailures(source, path),
  ];
};
