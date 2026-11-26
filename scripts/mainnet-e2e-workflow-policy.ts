/**
 * Trust boundary for the live mainnet E2E workflow.
 *
 * The workflow holds a funded hot-wallet key and runs on the self-hosted
 * runner, so it is a reviewed policy rather than a baseline workflow.
 *
 * Every run tests main's commit, taken from the triggering event (schedule or
 * a dispatch of the workflow from main; no input chooses it). Jobs split by
 * trust. `build` installs and builds that commit with no secret. `execute`
 * holds the key and may not install, build, check out, or print raw test
 * output. `preflight` and `post` run checked-out `main` code without the key,
 * and pass the spend baseline as a job output the code under test cannot
 * write. `execute` uses exactly the RPC preflight validated: it compares a
 * SHA-256 job output, re-checks HTTPS, the shared hosts and the mainnet chain
 * id, and never falls back. `report` upserts an issue on failure and `notify`
 * posts every enabled run's result to Slack; both are hosted, check nothing
 * out and run one pinned script.
 *
 * The primary control is an exact-bytes pin (`mainnet-e2e-workflow-pin.ts`):
 * any edit fails until its reviewed SHA-256 is updated. Behind it, as defence
 * in depth and as the statement of what was reviewed, every control is
 * judged on the parsed document, so a comment, an inert
 * string, a step that never runs, or a respelling cannot satisfy or evade it:
 * - `mainnet-e2e-workflow-document.ts` parses strictly and fails closed;
 * - `mainnet-e2e-workflow-jobs.ts` pins the top level and each job's settings;
 * - `mainnet-e2e-workflow-execute.ts` and `mainnet-e2e-workflow-steps.ts`
 *   allowlist every step, its `if:` and its actions, and compare every
 *   decoded script whole (security scripts as named control blocks);
 * - `mainnet-e2e-workflow-scripts.ts` holds the display-only scripts, and
 *   `mainnet-e2e-workflow-notify.ts` the Slack notifier step;
 * - `mainnet-e2e-workflow-secrets.ts` allows a secret only in its reviewed
 *   step env bindings, scanning every decoded string.
 */

import { mainnetE2eDocumentFailures } from "./mainnet-e2e-workflow-document";
import { mainnetE2ePinFailures } from "./mainnet-e2e-workflow-pin";

/**
 * Violations of the mainnet E2E workflow's reviewed controls: the exact-bytes
 * pin, then every structural check. `source` is the workflow text. The
 * function does not read the filesystem.
 */
export const mainnetE2eWorkflowFailures = (source: string): string[] => [
  ...mainnetE2ePinFailures(source),
  ...mainnetE2eDocumentFailures(source),
];
