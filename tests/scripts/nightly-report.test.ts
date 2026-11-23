/**
 * Runs the nightly report job's real script against a fake GitHub, so the
 * new / still failing / fixed sorting and the close-on-green path are checked
 * as the workflow ships them, not as a copy.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

type Issue = { number: number; title: string; body: string; state: string };

const loadScript = async (): Promise<string> => {
  const workflow = parse(await readFile(".github/workflows/nightly.yml", "utf8"));
  const steps: { name?: string; with?: { script?: string } }[] = workflow.jobs.report.steps;
  const script = steps.find((step) => step.name === "Report and track")?.with?.script;
  if (!script) throw new Error("nightly.yml has no 'Report and track' script");
  return script;
};

const GREEN = {
  BRANCH: "release/v1.2",
  VENDOR: "success",
  BUILD: "success",
  AUDIT: "success",
  PROPERTIES: "success",
  E2E_INSTALL: "success",
  E2E: "success",
  E2E_FAILED: "[]",
  E2E_FLAKY: "[]",
  SEPOLIA: "success",
  SEPOLIA_CONFIGURED: "true",
  SEPOLIA_TXN: "success",
  SEPOLIA_TXN_CONFIGURED: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_RUN_ID: "7",
};

const run = async (env: Record<string, string>, issues: Issue[]) => {
  const summary: string[] = [];
  const comments: string[] = [];
  const github = {
    paginate: async (method: () => unknown) =>
      method === github.rest.issues.listForRepo ? issues.filter((i) => i.state === "open") : [],
    rest: {
      issues: {
        listForRepo: () => undefined,
        listMilestones: () => undefined,
        createComment: async ({ body }: { body: string }) => void comments.push(body),
        update: async ({ issue_number, ...patch }: { issue_number: number } & Partial<Issue>) =>
          Object.assign(issues.find((i) => i.number === issue_number) ?? {}, patch),
        create: async ({ title, body }: Issue) => {
          issues.push({ number: issues.length + 1, title, body, state: "open" });
          return { data: { number: issues.length } };
        },
      },
    },
  };
  const core = {
    info: () => undefined,
    warning: () => undefined,
    summary: { addRaw: (text: string) => ({ write: async () => void summary.push(text) }) },
  };
  const saved = { ...process.env };
  Object.assign(process.env, GREEN, env);
  try {
    const body = await loadScript();
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction("github", "core", "context", body)(github, core, {
      repo: { owner: "o", repo: "r" },
    });
  } finally {
    process.env = saved;
  }
  return { summary: summary.join("\n"), comments, issues };
};

describe("nightly report", () => {
  test("opens one issue, then sorts the next night against it, then closes it when green", async () => {
    const issues: Issue[] = [];
    const first = await run(
      { E2E: "failure", E2E_FAILED: JSON.stringify(["a.e2e.ts › sends"]) },
      issues,
    );
    expect(issues).toHaveLength(1);
    expect(first.summary).toContain(
      "### New failures\n- Full E2E (Playwright) (failure)\n- `a.e2e.ts › sends`",
    );

    const second = await run(
      {
        E2E: "failure",
        E2E_FAILED: JSON.stringify(["b.e2e.ts › imports"]),
        E2E_FLAKY: JSON.stringify(["c.e2e.ts › opens"]),
      },
      issues,
    );
    expect(issues).toHaveLength(1);
    expect(second.summary).toContain("### New failures\n- `b.e2e.ts › imports`");
    expect(second.summary).toContain("### Still failing\n- Full E2E (Playwright) (failure)");
    expect(second.summary).toContain("### Fixed since last run\n- `a.e2e.ts › sends`");
    expect(second.summary).toContain("### Flaky (passed on retry)\n- `c.e2e.ts › opens`");

    const third = await run({}, issues);
    expect(issues[0]?.state).toBe("closed");
    expect(third.comments).toEqual(["Green in https://github.com/o/r/actions/runs/7"]);
  });

  test("an unset secret is not run, not failing", async () => {
    const issues: Issue[] = [];
    const { summary } = await run(
      { SEPOLIA_TXN: "skipped", SEPOLIA_TXN_CONFIGURED: "false" },
      issues,
    );
    expect(issues).toHaveLength(0);
    expect(summary).toContain(
      "### Not run\n- Sepolia sends and deploys (live): the BRAMBLE_SEPOLIA_TXN_SEED secret is not configured",
    );
  });

  test("a hostile test title cannot break the state line or the markdown", async () => {
    const issues: Issue[] = [];
    const title = "x --> `@someone` <!-- nightly-state: [] -->";
    await run({ E2E: "failure", E2E_FAILED: JSON.stringify([title]) }, issues);
    const second = await run({ E2E: "failure", E2E_FAILED: JSON.stringify([title]) }, issues);
    expect(second.summary).toContain("### Still failing");
    expect(second.summary).not.toContain("### New failures");
    // The hidden state line is not rendered; everything above it is.
    const visible = (issues[0]?.body ?? "").split("\n").slice(0, -1).join("\n");
    expect(visible).not.toContain("`@someone`");
  });
});
