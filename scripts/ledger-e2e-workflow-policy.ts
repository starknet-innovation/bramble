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
 * runner and trigger rules, so this module restates them more strictly, in
 * two independent layers:
 * - an exact-bytes SHA-256 pin of the file (`workflow-source-pin.ts`): any
 *   edit fails until {@link LEDGER_E2E_SHA256} is updated in a reviewed change,
 *   however a parser would read it;
 * - the decoded document, read as GitHub reads it
 *   (`ledger-e2e-workflow-document.ts`, `ledger-e2e-workflow-controls.ts`):
 *   the reviewed shape and each named control, so a pin update cannot admit a
 *   workflow that drops one, and a failure says which control went.
 * No control is matched as text in the source.
 */
import { ledgerE2eDocumentFailures } from "./ledger-e2e-workflow-document";
import { workflowPath } from "./workflow-policy-text";
import { sourcePinFailures } from "./workflow-source-pin";

/** File name of the Speculos Ledger E2E workflow. */
export const LEDGER_E2E_WORKFLOW = "ledger-e2e.yml";

/**
 * SHA-256 of the reviewed `ledger-e2e.yml`, byte for byte. Change it only
 * together with a reviewed change to the workflow.
 */
export const LEDGER_E2E_SHA256 = "ac18b8d27d1fa97fd80bf96ab0e24f274e563a003e68df4be6d816aa4e1fe715";

/**
 * Violations of the Ledger E2E workflow's reviewed controls. Pure: it reads
 * only the text it is given, so tests can mutate one control at a time. The
 * pin and the decoded checks both always run, so a mutation names the control
 * it breaks as well as the changed bytes.
 */
export const ledgerE2eWorkflowFailures = (source: string): string[] => {
  const path = workflowPath(LEDGER_E2E_WORKFLOW);
  return [
    ...sourcePinFailures(source, path, LEDGER_E2E_SHA256, "LEDGER_E2E_SHA256"),
    ...ledgerE2eDocumentFailures(source, path),
  ];
};
