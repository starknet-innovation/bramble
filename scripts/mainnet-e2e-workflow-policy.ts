/**
 * Trust boundary for the live mainnet E2E workflow.
 *
 * The workflow holds a funded hot-wallet key and runs on the self-hosted
 * runner, so it is a reviewed policy rather than a baseline workflow.
 *
 * Jobs split by trust. `build` runs release-controlled install and build with
 * no secret. `execute` holds the key and may not install, build, check out,
 * or print raw test output. `preflight` and `post` run trusted `main` code
 * without the key or the release commit, and pass the spend baseline as a
 * job output the code under test cannot write. `execute` uses exactly the RPC
 * preflight validated: it compares a SHA-256 job output, re-checks HTTPS, the
 * shared hosts and the mainnet chain id, and never falls back.
 *
 * Every control is judged on the parsed document, so a comment, an inert
 * string, a step that never runs, or a respelling cannot satisfy or evade it:
 * - `mainnet-e2e-workflow-document.ts` parses strictly and fails closed;
 * - `mainnet-e2e-workflow-jobs.ts` pins the top level and each job's settings;
 * - `mainnet-e2e-workflow-execute.ts` and `mainnet-e2e-workflow-steps.ts`
 *   allowlist every step, its `if:` and its actions, and compare every
 *   decoded script whole (security scripts as named control blocks);
 * - `mainnet-e2e-workflow-scripts.ts` holds the display-only scripts;
 * - `mainnet-e2e-workflow-secrets.ts` allows a secret only in its reviewed
 *   step env bindings, scanning every decoded string.
 */

import { mainnetE2eDocumentFailures } from "./mainnet-e2e-workflow-document";

/**
 * Violations of the mainnet E2E workflow's reviewed controls. `source` is the
 * workflow text. The function does not read the filesystem; a workflow that
 * does not parse exactly reports that and nothing else.
 */
export const mainnetE2eWorkflowFailures = (source: string): string[] =>
  mainnetE2eDocumentFailures(source);
