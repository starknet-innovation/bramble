/**
 * Pins the release workflow's provenance and immutability controls.
 *
 * The publisher must not replace an asset, must upload before it publishes,
 * and must not check out the release it is publishing. The rebuild and the
 * attestation each have their own job, and the OIDC token stays off every job
 * that executes the release commit.
 */

import type { WorkflowSources } from "./workflow-inventory";
import { forbidText, jobBody, requireText, workflowPath } from "./workflow-policy-text";

const ATTEST_ACTION = "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6";

const before = (
  failures: string[],
  source: string,
  earlier: string,
  later: string,
  failure: string,
): void => {
  const first = source.indexOf(earlier);
  const second = source.indexOf(later);
  if (first === -1 || second === -1 || first > second) failures.push(failure);
};

/**
 * Failures in the release workflows' pinned-build controls. Pure: it reads
 * only the supplied workflow sources and throws on none of them.
 */
export const releaseProvenanceFailures = (sources: WorkflowSources): string[] => {
  const failures: string[] = [];
  const releaseBuild = sources["release-build.yml"] ?? "";
  const rebuild = sources["release-verify.yml"] ?? "";
  const release = sources["release.yml"] ?? "";
  const auto = sources["auto-release.yml"] ?? "";
  const build = jobBody(releaseBuild, "build-release");
  const verifyCall = jobBody(releaseBuild, "verify-rebuild");
  const attest = jobBody(releaseBuild, "attest-release");
  const publish = jobBody(releaseBuild, "publish-release");
  const confirm = jobBody(releaseBuild, "confirm-release");
  const caller = jobBody(release, "build-release");
  const autoCaller = jobBody(auto, "release");
  const compute = jobBody(auto, "compute");

  for (const name of [
    "release-build.yml",
    "release-verify.yml",
    "release.yml",
    "auto-release.yml",
  ]) {
    forbidText(
      failures,
      sources[name] ?? "",
      "--clobber",
      `${workflowPath(name)} must not overwrite a release asset`,
    );
  }

  forbidText(
    failures,
    build,
    "id-token",
    "self-hosted release builds must not receive an OIDC token",
  );
  requireText(failures, build, "TZ: UTC", "release builds must package in UTC");
  forbidText(
    failures,
    verifyCall,
    "id-token",
    "the release rebuild must not receive an OIDC token",
  );
  forbidText(
    failures,
    verifyCall,
    "contents: write",
    "the release rebuild call must not receive repository write permission",
  );
  requireText(
    failures,
    verifyCall,
    "uses: ./.github/workflows/release-verify.yml",
    "the release build must rebuild the tag before publishing",
  );

  requireText(
    failures,
    attest,
    `uses: ${ATTEST_ACTION} # v4.2.2`,
    "release zips must be signed with the pinned attest action",
  );
  requireText(
    failures,
    attest,
    "subject-path: artifacts/bramble-*.zip",
    "the release attestation must cover the release zips",
  );
  requireText(
    failures,
    attest,
    "gh attestation verify",
    "the release build must verify its own build provenance before publishing",
  );
  requireText(
    failures,
    attest,
    "--signer-workflow",
    "build provenance must be pinned to the release workflow",
  );
  requireText(
    failures,
    attest,
    "permissions:\n      contents: read\n      id-token: write\n      attestations: write",
    "the attest job must take only the OIDC and attestation permissions",
  );
  forbidText(
    failures,
    attest,
    "actions/checkout@",
    "the attest job must not check out wallet source",
  );
  if (releaseBuild.split("id-token: write").length - 1 !== 1) {
    failures.push("release-build.yml must grant the OIDC token to the attest job only");
  }

  before(
    failures,
    publish,
    "--draft \\",
    "--draft=false",
    "assets must be uploaded to a draft before the release is published",
  );
  before(
    failures,
    publish,
    "gh release upload",
    "--draft=false",
    "assets must be uploaded before the release is published",
  );
  before(
    failures,
    publish,
    "cmp -s",
    "--draft=false",
    "the publisher must compare release assets before publishing",
  );
  before(
    failures,
    publish,
    "--draft=false",
    "gh release delete",
    "a release that fails attestation must be deleted only after publication was attempted",
  );
  requireText(
    failures,
    publish,
    "--verify-tag",
    "the publisher must bind the release to the existing tag",
  );
  forbidText(
    failures,
    publish,
    "actions/checkout@",
    "the hosted release publisher must not check out or execute wallet source",
  );
  if (releaseBuild.split("contents: write").length - 1 !== 1) {
    failures.push("release-build.yml must grant repository write to the publisher only");
  }

  requireText(failures, confirm, "cmp -s", "the confirm job must compare the published assets");
  requireText(
    failures,
    confirm,
    "gh release verify-asset",
    "the confirm job must verify the published asset attestation",
  );
  requireText(
    failures,
    confirm,
    "gh release verify ",
    "the confirm job must verify the release attestation",
  );
  requireText(
    failures,
    confirm,
    "permissions:\n      contents: read",
    "the confirm job must use read-only repository permission",
  );
  forbidText(
    failures,
    confirm,
    "contents: write",
    "the confirm job must not receive repository write permission",
  );
  forbidText(
    failures,
    confirm,
    "actions/checkout@",
    "the confirm job must not check out wallet source",
  );

  requireText(
    failures,
    rebuild,
    "runs-on: ubuntu-latest",
    "the release rebuild must use a hosted runner",
  );
  requireText(
    failures,
    rebuild,
    "permissions:\n      contents: read",
    "the release rebuild must declare read-only repository permission",
  );
  forbidText(failures, rebuild, "id-token", "the release rebuild must not receive an OIDC token");
  forbidText(
    failures,
    rebuild,
    "contents: write",
    "the release rebuild must not receive repository write permission",
  );
  requireText(
    failures,
    rebuild,
    "bun run package:extension\n",
    "the release rebuild must package Chromium",
  );
  requireText(
    failures,
    rebuild,
    "bun run package:extension:firefox",
    "the release rebuild must package Firefox",
  );
  requireText(failures, rebuild, "cmp -s", "the release rebuild must compare bytes");
  requireText(
    failures,
    rebuild,
    "gh release download",
    "the release rebuild must compare published assets when they exist",
  );
  requireText(
    failures,
    rebuild,
    'git checkout --detach "$RELEASE_COMMIT"',
    "the release rebuild must detach onto the verified commit",
  );
  requireText(
    failures,
    rebuild,
    "persist-credentials: false",
    "the release rebuild must not leave the checkout token in .git/config",
  );
  requireText(failures, rebuild, "TZ: UTC", "the release rebuild must package in UTC");

  requireText(
    failures,
    caller,
    "id-token: write",
    "the tag-driven release must grant the attest job an OIDC token",
  );
  requireText(
    failures,
    caller,
    "attestations: write",
    "the tag-driven release must grant the attest job attestation permission",
  );
  requireText(
    failures,
    autoCaller,
    "id-token: write",
    "the merge-driven release must grant the attest job an OIDC token",
  );
  requireText(
    failures,
    autoCaller,
    "attestations: write",
    "the merge-driven release must grant the attest job attestation permission",
  );
  forbidText(
    failures,
    compute,
    "id-token",
    "auto-release tag creation must not receive an OIDC token",
  );
  requireText(
    failures,
    auto,
    "--json isDraft",
    "auto-release must distinguish a draft from a published release",
  );
  requireText(
    failures,
    auto,
    '[ "$draft" = "false" ]',
    "auto-release must skip only a published release",
  );

  return failures;
};
