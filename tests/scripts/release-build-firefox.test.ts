/**
 * The release build must ship the Gecko package beside the Chromium one.
 *
 * v0.10.6 was released with only `bramble-<version>.zip` attached (#684): the
 * Firefox zip was built and AMO-linted on the release PR's head, never from the
 * tagged commit, so there was nothing exact to submit to addons.mozilla.org.
 * Kept apart from `workflow-security-policy.test.ts`, which covers trust
 * boundaries; this is about what a release contains.
 */
import { describe, expect, test } from "bun:test";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const FIREFOX_FAILURE = "release builds must package and validate the Firefox target";

describe("release build Firefox package", () => {
  test("the repository release build packages and validates Firefox", async () => {
    expect(workflowSecurityPolicyFailures(await readWorkflowSources())).not.toContain(
      FIREFOX_FAILURE,
    );
  });

  for (const script of ["package:extension:firefox", "check:firefox"]) {
    test(`rejects a release build that skips ${script}`, async () => {
      const sources = await readWorkflowSources();
      const source = sources["release-build.yml"] ?? "";
      const step = `- run: bun run ${script}`;
      expect(source).toContain(step);
      const changed = {
        ...sources,
        "release-build.yml": source.replace(step, "- run: echo skipped"),
      };
      expect(workflowSecurityPolicyFailures(changed)).toContain(FIREFOX_FAILURE);
    });
  }
});
