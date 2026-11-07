/**
 * The Ledger E2E and website-deploy policies read their workflows the way
 * GitHub's runner does (scripts/workflow-strict-document.ts): every edit in
 * `workflow-strict-yaml-mutations.ts` fails the full workflow gate with its
 * named failure, spellings that decode to the reviewed workflow still pass,
 * and the Ledger workflow is pinned to its exact bytes.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ledgerE2eDocumentFailures } from "../../scripts/ledger-e2e-workflow-document";
import {
  LEDGER_E2E_SHA256,
  ledgerE2eWorkflowFailures,
} from "../../scripts/ledger-e2e-workflow-policy";
import { websiteDeployFailures } from "../../scripts/website-deploy-policy";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";
import { sourcePinFailures, sourceSha256 } from "../../scripts/workflow-source-pin";
import { readWorkflowStrictly } from "../../scripts/workflow-strict-document";
import {
  applyEdits,
  FAILURE,
  LEDGER_CONTROLS,
  LEDGER_ISSUE_ROWS,
  LEDGER_MORE_ROWS,
  type StrictYamlMutation,
  WEBSITE_CONTROLS,
  WEBSITE_ROWS,
} from "./workflow-strict-yaml-mutations";

const LEDGER = ".github/workflows/ledger-e2e.yml";

const gateAfter = async (mutation: Omit<StrictYamlMutation, "failure">): Promise<string[]> => {
  const sources = await readWorkflowSources();
  const source = sources[mutation.workflow] ?? "";
  return workflowSecurityPolicyFailures({
    ...sources,
    [mutation.workflow]: applyEdits(source, mutation),
  });
};

const expectRejected = async (rows: readonly StrictYamlMutation[]): Promise<void> => {
  for (const row of rows) {
    const failures = await gateAfter(row);
    const path = `.github/workflows/${row.workflow} `;
    const named = failures.some(
      (failure) => failure.startsWith(path) && failure.includes(row.failure),
    );
    if (!named) throw new Error(`accepted ${row.label}:\n${failures.join("\n")}`);
  }
};

describe("Ledger E2E policy reads the workflow as GitHub does", () => {
  test("rejects every row of issue #887's table", async () => {
    expect(LEDGER_ISSUE_ROWS).toHaveLength(7);
    await expectRejected(LEDGER_ISSUE_ROWS);
  });

  test("rejects hidden lines, parser-specific forms and a changed byte", async () => {
    await expectRejected(LEDGER_MORE_ROWS);
  });

  test("decodes equivalent spellings as the reviewed workflow; only the pin moves", async () => {
    const source = (await readWorkflowSources())["ledger-e2e.yml"] ?? "";
    const pin = (text: string) =>
      sourcePinFailures(
        text,
        LEDGER,
        LEDGER_E2E_SHA256,
        "LEDGER_E2E_SHA256 in scripts/ledger-e2e-workflow-policy.ts",
      );
    const variants = [
      ...LEDGER_CONTROLS.map((control) => [control.label, applyEdits(source, control)] as const),
      ["CRLF line endings", source.replaceAll("\n", "\r\n")] as const,
    ];
    for (const [label, changed] of variants) {
      const document = ledgerE2eDocumentFailures(changed, LEDGER);
      if (document.length > 0) throw new Error(`rejected ${label}: ${document.join("\n")}`);
      expect(ledgerE2eWorkflowFailures(changed)).toEqual(pin(changed));
      expect(pin(changed)).toHaveLength(1);
    }
    expect(ledgerE2eWorkflowFailures(source)).toEqual([]);
  });

  test("pins the exact bytes on disk", async () => {
    const bytes = await readFile(LEDGER);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(LEDGER_E2E_SHA256);
    expect(sourceSha256(bytes.toString("utf8"))).toBe(LEDGER_E2E_SHA256);
    expect(sourcePinFailures("x\n", "w", sourceSha256("x\n"), "PIN")).toEqual([]);
    expect(sourcePinFailures("x\r\n", "w", sourceSha256("x\n"), "PIN")).toEqual([
      `w is not the reviewed file (SHA-256 ${sourceSha256("x\n")}): review the diff, then update PIN (now ${sourceSha256("x\r\n")})`,
    ]);
  });
});

describe("website-deploy policy reads workflows as GitHub does", () => {
  test("rejects hidden lines, directives, indirections and re-spelled controls", async () => {
    await expectRejected(WEBSITE_ROWS);
  });

  test("accepts equivalent spellings, and leaves other workflows their freedom", async () => {
    for (const control of WEBSITE_CONTROLS) {
      const failures = await gateAfter(control);
      if (failures.length > 0) throw new Error(`rejected ${control.label}: ${failures.join("\n")}`);
    }
  });

  test("the deploy workflow holds only allowlisted characters", async () => {
    const source = (await readWorkflowSources())["website-deploy.yml"] ?? "";
    expect(source).not.toContain("→");
    expect(websiteDeployFailures("website-deploy.yml", source)).toEqual([]);
    expect(websiteDeployFailures("website-deploy.yml", `${source}# a → b\n`)).toEqual([
      expect.stringMatching(
        /^\.github\/workflows\/website-deploy\.yml line \d+ must not contain U\+2192$/,
      ),
    ]);
  });

  test("an escaped token reference elsewhere pulls that workflow into the strict read", () => {
    const source = [
      "on: push",
      "jobs:",
      "  a: &a",
      "    runs-on: ubuntu-latest",
      `    env: {T: "${"$"}{{ secrets.CLOUDFLARE_API_\\u0054OKEN }}"}`,
      "    steps: [{run: echo}]",
      "",
    ].join("\n");
    expect(websiteDeployFailures("other.yml", source)).toEqual([
      `.github/workflows/other.yml ${FAILURE.indirection}`,
    ]);
    expect(websiteDeployFailures("other.yml", source.replace(" &a", ""))).toEqual([
      '.github/workflows/other.yml must keep a step named "Deploy to Cloudflare Workers" to bind the token in',
    ]);
  });

  test("fails closed on a document it cannot decode", () => {
    const aliases = ["a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let level = 0; level < 8; level += 1) {
      aliases.push(
        `${String.fromCharCode(98 + level)}: &${String.fromCharCode(98 + level)} [${Array(10)
          .fill(`*${String.fromCharCode(97 + level)}`)
          .join(", ")}]`,
      );
    }
    expect(websiteDeployFailures("bomb.yml", `${aliases.join("\n")}\n`)).toEqual([
      ".github/workflows/bomb.yml must be parseable YAML so its trust boundaries can be checked",
    ]);
  });

  test("checks the deploy job's environment, triggers, branch and guard on decoded values", async () => {
    const source = (await readWorkflowSources())["website-deploy.yml"] ?? "";
    const path = ".github/workflows/website-deploy.yml";
    const edit = (search: string, replacement: string) => {
      expect(source).toContain(search);
      return websiteDeployFailures("website-deploy.yml", source.replace(search, replacement));
    };
    expect(edit("      name: bramble-production\n", "      name: bramble-preview\n")).toContain(
      `${path} must deploy through the reviewed production environment`,
    );
    expect(edit('    branches: ["main"]\n', '    branches: ["ma*"]\n')).toContain(
      `${path} must trigger on exactly one literal production branch`,
    );
    expect(
      edit(
        "      - name: Reject manual runs outside the main branch\n",
        "      - if: false\n        name: Reject\n",
      ),
    ).toContain(`${path} must reject manual runs outside main, the branch its push filter names`);
    expect(edit("on:\n  push:", "on:\n  pull_request:\n  push:")).toContain(
      `${path} must never run on a pull-request revision`,
    );
  });
});

describe("strict workflow reader", () => {
  test("refuses a file without a final line feed and reads a clean one", () => {
    expect(readWorkflowStrictly("a: 1", "w", "unreadable").failures).toEqual([
      "w must end with a line feed",
    ]);
    expect(readWorkflowStrictly("a: [\n", "w", "unreadable").failures).toEqual(["unreadable"]);
    expect(readWorkflowStrictly('a: "x"\nb: 1\n', "w", "unreadable")).toEqual({
      failures: [],
      value: { a: "x", b: 1 },
    });
  });
});
