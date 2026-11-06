/**
 * Trust-boundary policy for the mobile workflow (`.github/workflows/mobile.yml`).
 *
 * The mobile jobs need hosted macOS runners (Xcode, the iOS simulator, and the
 * `.dylib` host build that UniFFI's bindgen reads), which the baseline policy
 * reserves for reviewed workflows. Being reviewed also lifts the baseline's
 * trigger rules, so this policy restates them and adds what a build-and-test
 * workflow with no credentials should never gain: it runs pull-request code
 * through third-party build tools (Cargo, Gradle, xcodebuild), so it must hold no
 * write scope, no secret, and no persisted checkout token, and it may execute
 * only pinned or lockfile-resolved tools.
 *
 * Pure text analysis, like the rest of the workflow gates; it fails closed by
 * reporting a violation for anything it does not recognize as allowed.
 */
import { dynamicExecutionFailures } from "./vendor-pin-policy";
import { actionReferences } from "./workflow-inventory";
import { forbidText, workflowPath } from "./workflow-policy-text";

/** File name of the mobile workflow, as keyed in the workflow inventory. */
export const MOBILE_WORKFLOW = "mobile.yml";

// Hosted runner labels the mobile jobs may use. A label is an exact image, so a
// self-hosted or larger-runner label is refused rather than merely unlisted.
const MOBILE_RUNNERS = new Set(["ubuntu-latest", "macos-15"]);

/**
 * Returns every violation of the mobile workflow's reviewed policy. Performs no
 * I/O so tests can mutate one control at a time.
 */
export const mobileWorkflowFailures = (source: string): string[] => {
  const failures: string[] = [];
  const path = workflowPath(MOBILE_WORKFLOW);
  for (const line of source.split("\n").filter((text) => /^\s*runs-on:/.test(text))) {
    const label = line.trim().slice("runs-on:".length).trim();
    if (!MOBILE_RUNNERS.has(label)) {
      failures.push(`${path} must run on ubuntu-latest or macos-15, not \`${label}\``);
    }
  }
  for (const trigger of ["pull_request_target:", "workflow_run:"]) {
    forbidText(failures, source, trigger, `${path} must not use the privileged ${trigger} trigger`);
  }
  forbidText(failures, source, ": write", `${path} must not request any write permission`);
  if (/\bsecrets\s*[.[]/.test(source)) {
    failures.push(`${path} must not read repository secrets`);
  }
  const checkouts = actionReferences(source).filter(({ reference }) =>
    reference.startsWith("actions/checkout@"),
  ).length;
  const persisted = source.split("persist-credentials: false").length - 1;
  if (checkouts === 0 || persisted !== checkouts) {
    failures.push(`${path} must check out with persist-credentials: false in every job`);
  }
  failures.push(...dynamicExecutionFailures(source, path));
  return failures;
};
