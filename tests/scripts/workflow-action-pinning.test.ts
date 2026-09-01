/**
 * MCW-V09-131: the file-standards gate extracted action references with a regex
 * anchored on the list-item dash (`- uses:`), so every `uses:` written under a
 * `- name:` step — and every job-level `uses:` — escaped the SHA-pin rule. Seven
 * such references shipped; all were pinned, but nothing enforced that.
 *
 * The extraction and the pin rule now live in scripts/workflow-inventory.ts and
 * are exercised here directly, so this suite tests the gate rather than a second
 * copy of its rule. Exactly one unpinned form is allowed: a local reusable
 * workflow, which is repository content and therefore already covered by review.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  actionReferences,
  isPinnedActionReference,
  readWorkflowSources,
} from "../../scripts/workflow-inventory";

const unpinned = (source: string): readonly string[] =>
  actionReferences(source)
    .filter(({ reference }) => !isPinnedActionReference(reference))
    .map(({ line, reference }) => `${line}:${reference}`);

describe("workflow action pinning", () => {
  test("every workflow in the repository is inspected", async () => {
    const files = Object.keys(await readWorkflowSources());
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("auto-release.yml");
    expect(files).toContain("terminal-ci.yml");
    expect(files).toContain("ui-lab.yml");
  });

  test("every action reference is pinned to a commit SHA", async () => {
    for (const [file, source] of Object.entries(await readWorkflowSources())) {
      expect({ file, unpinned: unpinned(source) }).toEqual({ file, unpinned: [] });
    }
  });

  test("reaches every reference written without the list-item dash", async () => {
    // Named by file and line rather than counted: a count survives the
    // dash-anchored regression (44 dash-form references still dominate the
    // total), so it pinned nothing. Each bare reference below must be present.
    const sources = await readWorkflowSources();
    const bare: string[] = [];
    const extracted: string[] = [];
    for (const [file, source] of Object.entries(sources)) {
      source.split("\n").forEach((line, index) => {
        if (/^[ \t]+uses:/.test(line)) {
          bare.push(`${file}:${index + 1}`);
        }
      });
      extracted.push(...actionReferences(source).map(({ line }) => `${file}:${line}`));
    }

    expect(bare.length).toBeGreaterThan(0);
    for (const location of bare) {
      expect(extracted).toContain(location);
    }
  });

  test("resolves every YAML spelling of the uses key GitHub executes", () => {
    const spellings = {
      "block step": "      - uses: actions/checkout@v4",
      "flow mapping": "      - {uses: actions/checkout@v4}",
      "flow sequence": "    steps: [{uses: actions/checkout@v4}]",
      "double-quoted key": '      - "uses": actions/checkout@v4',
      "single-quoted key": "      - 'uses': actions/checkout@v4",
    };
    for (const [spelling, line] of Object.entries(spellings)) {
      expect({ spelling, unpinned: unpinned(line) }).toEqual({
        spelling,
        unpinned: ["1:actions/checkout@v4"],
      });
    }
  });

  test("fails closed on a uses value the extractor cannot resolve", () => {
    // A plain scalar continued on the next line is valid YAML that GitHub runs.
    // The extractor cannot resolve it textually, so it must report the line as
    // unpinned rather than drop the reference.
    const workflow = ["jobs:", "  a:", "    steps:", "      - uses:", "          org/x@main"].join(
      "\n",
    );
    expect(unpinned(workflow)).toEqual(["4:- uses:"]);
  });

  test("flags an indirect reference the extractor cannot evaluate", () => {
    // A YAML alias and a folded scalar both resolve elsewhere. Neither can be
    // read as a pinned commit here, so both must be reported.
    expect(unpinned("      - uses: *pinned")).toEqual(["1:*pinned"]);
    expect(unpinned("      - uses: >-\n          attacker/x@main")).toEqual(["1:>-"]);
  });

  test("reads a workflow written as inline JSON", () => {
    // YAML is a superset of JSON and GitHub runs this form too.
    expect(unpinned('{"jobs":{"a":{"steps":[{"uses": "attacker/x@main"}]}}}')).toEqual([
      "1:attacker/x@main",
    ]);
  });

  test("ignores a commented-out reference and an unrelated key ending in uses", () => {
    const workflow = [
      "jobs:",
      "  a:",
      "    permissions:",
      "      statuses: write",
      "    steps:",
      "      # uses: actions/checkout@v4",
      "      - run: echo hi",
    ].join("\n");
    expect(actionReferences(workflow)).toEqual([]);
  });

  test("allows a local reusable workflow written with the .yaml extension", () => {
    expect(isPinnedActionReference("./.github/workflows/release-build.yaml")).toBe(true);
  });

  test("catches an unpinned action on a named step, which the dash-anchored rule misses", () => {
    const workflow = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - name: Report",
      "        uses: actions/github-script@v9",
    ].join("\n");
    expect(unpinned(workflow)).toEqual(["5:actions/github-script@v9"]);
  });

  test("catches an unpinned job-level workflow reference", () => {
    const workflow = ["jobs:", "  release:", "    uses: some-org/release.yml@main"].join("\n");
    expect(unpinned(workflow)).toEqual(["3:some-org/release.yml@main"]);
  });

  test("allows a local reusable workflow", () => {
    const workflow = [
      "jobs:",
      "  release:",
      "    uses: ./.github/workflows/release-build.yml",
    ].join("\n");
    expect(unpinned(workflow)).toEqual([]);
  });

  test("the file-standards gate reports these references, not its own regex", async () => {
    const gate = await readFile("scripts/check-file-standards.ts", "utf8");
    expect(gate).toContain("actionReferences(text)");
    expect(gate).toContain("isPinnedActionReference(reference)");
    expect(gate).toContain(`${"$"}{WORKFLOW_DIR}/`);
    // The dash-anchored pattern must not come back anywhere in the gate.
    expect(gate).not.toContain("-\\s+uses:");
  });
});
