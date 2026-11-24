/**
 * The release provenance rules are part of the workflow security gate. These
 * mutations check that removing one control is reported on its own.
 */
import { describe, expect, test } from "bun:test";
import { releaseProvenanceFailures } from "../../scripts/release-provenance-policy";
import { readWorkflowSources, type WorkflowSources } from "../../scripts/workflow-inventory";

const mutate = (
  sources: WorkflowSources,
  workflow: string,
  search: string,
  replacement: string,
): WorkflowSources => {
  const source = sources[workflow] ?? "";
  expect(source).toContain(search);
  return { ...sources, [workflow]: source.replace(search, replacement) };
};

describe("release provenance policy", () => {
  test("accepts the release workflows", async () => {
    expect(releaseProvenanceFailures(await readWorkflowSources())).toEqual([]);
  });

  const cases = [
    {
      name: "rejects a publisher that overwrites an existing asset",
      workflow: "release-build.yml",
      search: "gh release upload",
      replacement: "gh release upload --clobber",
      failure: ".github/workflows/release-build.yml must not overwrite a release asset",
    },
    {
      name: "rejects publishing before the release is a draft with its assets",
      workflow: "release-build.yml",
      search: "--draft \\",
      replacement: "--title \\",
      failure: "assets must be uploaded to a draft before the release is published",
    },
    {
      name: "rejects an unpinned provenance action",
      workflow: "release-build.yml",
      search: "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2",
      replacement: "actions/attest@v4",
      failure: "release zips must be signed with the pinned attest action",
    },
    {
      name: "rejects an OIDC token on the self-hosted build",
      workflow: "release-build.yml",
      search: "build-release:\n    permissions:\n      contents: read",
      replacement: "build-release:\n    permissions:\n      contents: read\n      id-token: write",
      failure: "self-hosted release builds must not receive an OIDC token",
    },
    {
      name: "rejects a rebuild that does not compare bytes",
      workflow: "release-verify.yml",
      search: "cmp -s",
      replacement: "true",
      failure: "the release rebuild must compare bytes",
    },
    {
      name: "rejects a tag-driven release that cannot sign provenance",
      workflow: "release.yml",
      search: "id-token: write",
      replacement: "id-token: none",
      failure: "the tag-driven release must grant the attest job an OIDC token",
    },
    {
      name: "rejects treating a draft as a finished release",
      workflow: "auto-release.yml",
      search: "--json isDraft --jq .isDraft",
      replacement: "--json tagName --jq .tagName",
      failure: "auto-release must distinguish a draft from a published release",
    },
  ] as const;

  for (const item of cases) {
    test(item.name, async () => {
      const changed = mutate(
        await readWorkflowSources(),
        item.workflow,
        item.search,
        item.replacement,
      );
      expect(releaseProvenanceFailures(changed)).toContain(item.failure);
    });
  }
});
