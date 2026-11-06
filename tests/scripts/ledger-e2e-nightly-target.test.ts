/**
 * The Ledger E2E workflow's nightly target (scripts/ledger-e2e-nightly-target.ts):
 * a scheduled run tests the active release branch at an immutable commit.
 * Mutation cases change one piece of the real workflow and expect the policy
 * to name it; behaviour cases run the pinned script under bash with a fake
 * `git ls-remote`.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NIGHTLY_TARGET_SCRIPT } from "../../scripts/ledger-e2e-nightly-target";
import { readWorkflowSources, type WorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";

const WORKFLOW = "ledger-e2e.yml";
const PATH = `.github/workflows/${WORKFLOW}`;
const EXPRESSION = "$" + "{{";
const FIRST = `${PATH} must resolve the nightly release commit first, exactly as reviewed`;
const SECOND = `${PATH} must check out the resolved nightly commit second`;
const COMMANDS = `${PATH} job speculos must run exactly the reviewed commands, in order`;
const REF = `          ref: ${EXPRESSION} steps.target.outputs.revision }}\n`;
const CHECKOUT = `      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n${REF}`;

const mutate = (sources: WorkflowSources, search: string, replacement: string) => {
  const source = sources[WORKFLOW] ?? "";
  expect(source).toContain(search);
  return { ...sources, [WORKFLOW]: source.replace(search, () => replacement) };
};

const failuresAfter = async (search: string, replacement: string) =>
  workflowSecurityPolicyFailures(mutate(await readWorkflowSources(), search, replacement));

const resolveStep = async (): Promise<string> => {
  const source = (await readWorkflowSources())[WORKFLOW] ?? "";
  const start = source.indexOf("      - name: Resolve the nightly release commit\n");
  const end = source.indexOf(CHECKOUT);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("Ledger E2E nightly target policy", () => {
  test("the workflow's first step is the reviewed resolve step", async () => {
    const source = (await readWorkflowSources())[WORKFLOW] ?? "";
    expect(source).toContain(`    steps:\n`);
    expect(await resolveStep()).toContain("        id: target\n");
    expect(workflowSecurityPolicyFailures(await readWorkflowSources())).toEqual([]);
  });

  test("rejects dropping the resolve step or running it after the checkout", async () => {
    const step = await resolveStep();
    const dropped = await failuresAfter(step, "");
    expect(dropped).toContain(FIRST);
    expect(dropped).toContain(SECOND);
    expect(dropped).toContain(COMMANDS);
    const after = await failuresAfter(`${step}${CHECKOUT}`, `${CHECKOUT}${step}`);
    expect(after).toContain(FIRST);
    expect(after).toContain(SECOND);
  });

  test("rejects a checkout that ignores, replaces or widens the resolved commit", async () => {
    for (const replacement of [
      "",
      "          ref: main\n",
      `          ref: ${EXPRESSION} github.ref }}\n`,
      `          ref: ${EXPRESSION} steps.target.outputs.branch }}\n`,
      `${REF}          fetch-depth: 0\n`,
    ]) {
      expect(await failuresAfter(REF, replacement)).toContain(SECOND);
    }
    expect(
      await failuresAfter(
        CHECKOUT,
        CHECKOUT.replace("        with:\n", "        if: false\n        with:\n"),
      ),
    ).toContain(SECOND);
  });

  test("rejects any other checkout implementation, even one pinned by SHA", async () => {
    expect(
      await failuresAfter(
        CHECKOUT,
        CHECKOUT.replace("3d3c42e5aac5ba805825da76410c181273ba90b1", "a".repeat(40)),
      ),
    ).toContain(SECOND);
  });

  test("rejects a widened source for the branch name", async () => {
    for (const [search, replacement] of [
      [`${EXPRESSION} vars.ACTIVE_RELEASE_BRANCH }}`, `${EXPRESSION} github.head_ref }}`],
      [
        `          EVENT_NAME: ${EXPRESSION} github.event_name }}\n`,
        `          EVENT_NAME: ${EXPRESSION} github.event_name }}\n          GH_REF: main\n`,
      ],
      ["        id: target\n", "        id: nightly\n"],
      ["'refs/heads/release/*'", "'refs/heads/*'"],
    ] as const) {
      const failures = await failuresAfter(search, replacement);
      expect(failures).toContain(FIRST);
    }
  });

  test("rejects dropping any of the pattern, existence or commit checks", async () => {
    for (const [search, replacement] of [
      ['if [ "$EVENT_NAME" != "schedule" ]', 'if [ "$EVENT_NAME" = "never" ]'],
      ['if [[ ! "$candidate" =~ ^release/v[0-9]+\\.[0-9]+(\\.[0-9]+)?$ ]]', "if false"],
      ['if [ -z "$revision" ]', "if false"],
      ['if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]', "if false"],
      ["sort -V | tail -1", "head -1"],
      ["set -euo pipefail\n", "set -eu\n"],
    ] as const) {
      const failures = await failuresAfter(search, replacement);
      expect(failures).toContain(FIRST);
      expect(failures).toContain(COMMANDS);
    }
  });

  test("only the resolve step may set an id or environment", async () => {
    const suite = "        run: BRAMBLE_SPECULOS_REQUIRED=1 bun run test:e2e:ledger\n";
    const message = `${PATH} job speculos must not give a step an id or environment`;
    expect(await failuresAfter(suite, `        id: suite\n${suite}`)).toContain(message);
    expect(await failuresAfter(suite, `        env:\n          CI: "1"\n${suite}`)).toContain(
      message,
    );
  });
});

const SHA = (digit: string) => digit.repeat(40);
const HEADS = [
  `${SHA("1")}\trefs/heads/release/v0.10.9`,
  `${SHA("2")}\trefs/heads/release/v0.10.10`,
  `${SHA("3")}\trefs/heads/release/v0.9.20`,
  `${SHA("4")}\trefs/heads/release/v1.0-rc`,
  `${SHA("5")}\trefs/heads/release/experiment`,
].join("\n");

type Run = { exitCode: number; output: string; stderr: string; gitCalls: string };

const runResolve = async (env: Record<string, string>, heads = HEADS, gitFails = false) => {
  const dir = await mkdtemp(join(process.env["TMPDIR"] ?? tmpdir(), "ledger-nightly-"));
  try {
    const git = join(dir, "git");
    await writeFile(
      git,
      `#!/bin/sh\necho "$*" >> "${dir}/git-calls"\n${gitFails ? "exit 128" : `cat "${dir}/heads"`}\n`,
      { mode: 0o755 },
    );
    await writeFile(join(dir, "heads"), heads ? `${heads}\n` : "");
    for (const file of ["output", "summary", "git-calls"]) await writeFile(join(dir, file), "");
    const child = Bun.spawn(["bash", "-e", "-c", NIGHTLY_TARGET_SCRIPT], {
      env: {
        PATH: `${dir}:${process.env["PATH"] ?? ""}`,
        GITHUB_OUTPUT: join(dir, "output"),
        GITHUB_STEP_SUMMARY: join(dir, "summary"),
        GITHUB_REPOSITORY: "starknet-innovation/bramble",
        ...env,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const exitCode = await child.exited;
    return {
      exitCode,
      gitCalls: await readFile(join(dir, "git-calls"), "utf8"),
      output: await readFile(join(dir, "output"), "utf8"),
      stderr: `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`,
    } satisfies Run;
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

describe("Ledger E2E nightly target script", () => {
  test("outside a schedule it outputs an empty revision and reads nothing", async () => {
    for (const event of ["pull_request", "push", "workflow_dispatch"]) {
      const run = await runResolve({ EVENT_NAME: event, ACTIVE_RELEASE_BRANCH: "release/v0.10.9" });
      expect(run.exitCode).toBe(0);
      expect(run.output).toBe("revision=\n");
      expect(run.gitCalls).toBe("");
    }
  });

  test("a schedule picks the highest-semver release branch at its commit", async () => {
    const run = await runResolve({ EVENT_NAME: "schedule" });
    expect(run.exitCode).toBe(0);
    expect(run.output).toBe(`revision=${SHA("2")}\n`);
    expect(run.gitCalls).toBe(
      "ls-remote --heads https://github.com/starknet-innovation/bramble.git refs/heads/release/*\n",
    );
  });

  test("vars.ACTIVE_RELEASE_BRANCH wins when it names an existing release branch", async () => {
    const run = await runResolve({
      EVENT_NAME: "schedule",
      ACTIVE_RELEASE_BRANCH: "release/v0.10.9",
    });
    expect(run.exitCode).toBe(0);
    expect(run.output).toBe(`revision=${SHA("1")}\n`);
  });

  test("fails closed on a bad, missing or unreadable branch, never falling back to main", async () => {
    for (const branch of [
      "main",
      "release/v1.0-rc",
      "release/experiment",
      "release/v0.10.9 ",
      "refs/heads/release/v0.10.9",
      "release/v0.10.9;true",
      "release/v9.9.9",
    ]) {
      const run = await runResolve({ EVENT_NAME: "schedule", ACTIVE_RELEASE_BRANCH: branch });
      expect(run.exitCode).toBe(1);
      expect(run.output).toBe("");
    }
    const none = await runResolve({ EVENT_NAME: "schedule" }, `${SHA("5")}\trefs/heads/release/x`);
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain("No release/* branch exists");
    const unreadable = await runResolve({ EVENT_NAME: "schedule" }, HEADS, true);
    expect(unreadable.exitCode).not.toBe(0);
    expect(unreadable.output).toBe("");
    const short = await runResolve(
      { EVENT_NAME: "schedule" },
      "abc123\trefs/heads/release/v0.10.9",
    );
    expect(short.exitCode).toBe(1);
    expect(short.stderr).toContain("did not resolve to an immutable commit");
  });
});
