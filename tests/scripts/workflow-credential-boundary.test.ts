/**
 * Confined credentials and environments stay in the workflow files that use
 * them today (scripts/workflow-credential-boundary.ts): a copy of a reviewed
 * deploy workflow under another name, or any spelling of a confined name,
 * fails the gate, while the real workflows pass.
 */
import { describe, expect, test } from "bun:test";
import {
  CREDENTIAL_BOUNDARIES,
  credentialBoundaryFailures,
} from "../../scripts/workflow-credential-boundary";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";
import {
  BOUNDARY_CASES,
  BOUNDARY_CONTROLS,
  plainWorkflow,
} from "./workflow-credential-boundary-cases";

describe("credential boundary", () => {
  test("refuses each confined credential or environment outside its file", async () => {
    const sources = await readWorkflowSources();
    for (const { label, file, source, failure } of BOUNDARY_CASES) {
      const failures = workflowSecurityPolicyFailures({ ...sources, [file]: source(sources) });
      const named = failures.some(
        (text) => text.startsWith(`.github/workflows/${file} `) && text.includes(failure ?? ""),
      );
      if (!named) throw new Error(`accepted ${label}:\n${failures.join("\n")}`);
    }
  });

  test("the real workflows and unconfined names pass", async () => {
    const sources = await readWorkflowSources();
    expect(workflowSecurityPolicyFailures(sources)).toEqual([]);
    for (const [name, source] of Object.entries(sources)) {
      expect(credentialBoundaryFailures(name, source)).toEqual([]);
    }
    for (const { label, file, source } of BOUNDARY_CONTROLS) {
      const failures = workflowSecurityPolicyFailures({ ...sources, [file]: source(sources) });
      if (failures.length > 0) throw new Error(`rejected ${label}: ${failures.join("\n")}`);
    }
  });

  test("each confined name is used today only by its owner", async () => {
    const sources = await readWorkflowSources();
    for (const { files, secrets, environments } of CREDENTIAL_BOUNDARIES) {
      for (const file of files) {
        const text = (sources[file] ?? "").toUpperCase();
        const used = [...secrets, ...environments].some((word) =>
          text.includes(word.toUpperCase()),
        );
        expect(used).toBe(true);
      }
    }
  });

  test("fails closed on a workflow it cannot read", () => {
    expect(credentialBoundaryFailures("bad.yml", `${plainWorkflow()}  bad: [\n`)).toEqual([
      ".github/workflows/bad.yml must parse so its credential boundaries can be checked",
    ]);
  });
});
