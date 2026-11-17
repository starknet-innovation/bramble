/**
 * The issue-821 Sepolia seed file reaches CI as one secret, and only the
 * nightly's live Sepolia step may see it (scripts/workflow-sepolia-policy.ts).
 * Each case mutates one control in the real workflows and expects the policy to
 * name it.
 */
import { describe, expect, test } from "bun:test";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const SECRET = "secrets.BRAMBLE_SEPOLIA_SEEDS";
const STEP_ENV = `          BRAMBLE_SEPOLIA_SEEDS: $\{{ ${SECRET} }}\n`;

describe("Sepolia seed secret policy", () => {
  test("the nightly holds it, scoped to the live Sepolia step", async () => {
    const sources = await readWorkflowSources();
    expect(sources["nightly.yml"]).toContain(STEP_ENV);
    expect(workflowSecurityPolicyFailures(sources)).toEqual([]);
  });

  test("any other workflow referencing it fails", async () => {
    const sources = await readWorkflowSources();
    const ci = `${sources["ci.yml"] ?? ""}\n# $\{{ ${SECRET} }}\n`;
    expect(workflowSecurityPolicyFailures({ ...sources, "ci.yml": ci })).toContain(
      ".github/workflows/ci.yml must not reference the Sepolia seed secret",
    );
  });

  test("the bracket form counts as a reference", async () => {
    const sources = await readWorkflowSources();
    const ci = `${sources["ci.yml"] ?? ""}\n# $\{{ secrets['BRAMBLE_SEPOLIA_SEEDS'] }}\n`;
    expect(workflowSecurityPolicyFailures({ ...sources, "ci.yml": ci })).toContain(
      ".github/workflows/ci.yml must not reference the Sepolia seed secret",
    );
  });

  test("a lower-case reference still counts", async () => {
    const sources = await readWorkflowSources();
    const ci = `${sources["ci.yml"] ?? ""}\n# $\{{ secrets.bramble_sepolia_seeds }}\n`;
    expect(workflowSecurityPolicyFailures({ ...sources, "ci.yml": ci })).toContain(
      ".github/workflows/ci.yml must not reference the Sepolia seed secret",
    );
  });

  test("handing every secret on is caught in any case or spacing", async () => {
    const sources = await readWorkflowSources();
    for (const [form, label] of [
      ["${{ tojson( secrets ) }}", "toJSON(secrets)"],
      ["secrets:   INHERIT", "secrets: inherit"],
    ]) {
      const ci = `${sources["ci.yml"] ?? ""}\n# ${form}\n`;
      expect(workflowSecurityPolicyFailures({ ...sources, "ci.yml": ci })).toContain(
        `.github/workflows/ci.yml must not use ${label}`,
      );
    }
  });

  test("the live step runs only when the seeds are configured", async () => {
    const sources = await readWorkflowSources();
    const nightly = (sources["nightly.yml"] ?? "").replace(
      "        if: steps.sepolia_seeds.outputs.configured == 'true'\n",
      "",
    );
    expect(workflowSecurityPolicyFailures({ ...sources, "nightly.yml": nightly })).toContain(
      ".github/workflows/nightly.yml must scope the Sepolia seeds to its live Sepolia step",
    );
  });

  test("handing every secret on fails in any workflow", async () => {
    const sources = await readWorkflowSources();
    const ci = `${sources["ci.yml"] ?? ""}\n# $\{{ toJSON(secrets) }}\n`;
    expect(workflowSecurityPolicyFailures({ ...sources, "ci.yml": ci })).toContain(
      ".github/workflows/ci.yml must not use toJSON(secrets)",
    );
  });

  test("no workflow records a Sepolia tape", async () => {
    const sources = await readWorkflowSources();
    const nightly = (sources["nightly.yml"] ?? "").replace(
      "BRAMBLE_DATASET_NETWORK=sepolia \\\n",
      'BRAMBLE_DATASET_NETWORK=sepolia BRAMBLE_SEPOLIA_RECORD="$RUNNER_TEMP/tape.json" \\\n',
    );
    expect(nightly).toContain("BRAMBLE_SEPOLIA_RECORD");
    expect(workflowSecurityPolicyFailures({ ...sources, "nightly.yml": nightly })).toContain(
      ".github/workflows/nightly.yml must not use BRAMBLE_SEPOLIA_RECORD",
    );
  });

  test("the live Sepolia step may not write to later steps", async () => {
    const sources = await readWorkflowSources();
    const nightly = (sources["nightly.yml"] ?? "").replace(
      "          unset BRAMBLE_SEPOLIA_SEEDS\n",
      '          echo "LEAK=$BRAMBLE_SEPOLIA_SEEDS" >> "$GITHUB_ENV"\n          unset BRAMBLE_SEPOLIA_SEEDS\n',
    );
    expect(nightly).toContain("GITHUB_ENV");
    expect(workflowSecurityPolicyFailures({ ...sources, "nightly.yml": nightly })).toContain(
      ".github/workflows/nightly.yml must not let the live Sepolia step write to later steps",
    );
  });

  test("an extra reference in the nightly fails", async () => {
    const sources = await readWorkflowSources();
    const nightly = (sources["nightly.yml"] ?? "").replace(
      "    runs-on:\n      - codebuild",
      `    env:\n      LEAK: $\{{ ${SECRET} }}\n    runs-on:\n      - codebuild`,
    );
    expect(workflowSecurityPolicyFailures({ ...sources, "nightly.yml": nightly })).toContain(
      ".github/workflows/nightly.yml must reference the Sepolia seed secret exactly twice",
    );
  });

  test("moving it out of the Sepolia step fails", async () => {
    const sources = await readWorkflowSources();
    const nightly = (sources["nightly.yml"] ?? "")
      .replace(`        env:\n${STEP_ENV}`, "")
      .replace(
        "      - name: Build extension\n",
        `      - name: Build extension\n        env:\n${STEP_ENV}`,
      );
    expect(workflowSecurityPolicyFailures({ ...sources, "nightly.yml": nightly })).toContain(
      ".github/workflows/nightly.yml must scope the Sepolia seeds to its live Sepolia step",
    );
  });
});
