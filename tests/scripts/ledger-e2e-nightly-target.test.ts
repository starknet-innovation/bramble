/**
 * The Ledger E2E workflow's nightly target (scripts/ledger-e2e-nightly-target.ts):
 * a scheduled run tests `main` at an immutable commit.
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
const FIRST = `${PATH} must resolve the nightly main commit first, exactly as reviewed`;
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
  const start = source.indexOf("      - name: Resolve the nightly main commit\n");
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

  test("rejects a widened or configurable source for the tested ref", async () => {
    for (const [search, replacement] of [
      [
        `          EVENT_NAME: ${EXPRESSION} github.event_name }}\n`,
        `          EVENT_NAME: ${EXPRESSION} github.event_name }}\n          ACTIVE_RELEASE_BRANCH: ${EXPRESSION} vars.ACTIVE_RELEASE_BRANCH }}\n`,
      ],
      ["        id: target\n", "        id: nightly\n"],
      ["'refs/heads/main')", "'refs/heads/*')"],
      ['$2 == "refs/heads/main"', '$2 ~ "refs/heads/"'],
    ] as const) {
      const failures = await failuresAfter(search, replacement);
      expect(failures).toContain(FIRST);
    }
  });

  test("rejects dropping any of the pattern, existence or commit checks", async () => {
    for (const [search, replacement] of [
      ['if [ "$EVENT_NAME" != "schedule" ]', 'if [ "$EVENT_NAME" = "never" ]'],
      ['if [ -z "$revision" ]', "if false"],
      ['if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]', "if false"],
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
const HEADS = `${SHA("1")}\trefs/heads/main`;

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
      const run = await runResolve({ EVENT_NAME: event });
      expect(run.exitCode).toBe(0);
      expect(run.output).toBe("revision=\n");
      expect(run.gitCalls).toBe("");
    }
  });

  test("a schedule resolves main to its commit", async () => {
    const run = await runResolve({ EVENT_NAME: "schedule" });
    expect(run.exitCode).toBe(0);
    expect(run.output).toBe(`revision=${SHA("1")}\n`);
    expect(run.gitCalls).toBe(
      "ls-remote --heads https://github.com/starknet-innovation/bramble.git refs/heads/main\n",
    );
  });

  test("a configured release branch cannot redirect it", async () => {
    const run = await runResolve({
      EVENT_NAME: "schedule",
      ACTIVE_RELEASE_BRANCH: "release/v0.10",
    });
    expect(run.output).toBe(`revision=${SHA("1")}\n`);
  });

  test("fails closed on a missing, look-alike, unreadable or short main", async () => {
    for (const heads of [
      "",
      `${SHA("2")}\trefs/heads/release/v0.10`,
      `${SHA("2")}\trefs/heads/main-old`,
      `${SHA("2")}\trefs/heads/x/main`,
    ]) {
      const run = await runResolve({ EVENT_NAME: "schedule" }, heads);
      expect(run.exitCode).toBe(1);
      expect(run.output).toBe("");
      expect(run.stderr).toContain("main does not exist");
    }
    const unreadable = await runResolve({ EVENT_NAME: "schedule" }, HEADS, true);
    expect(unreadable.exitCode).not.toBe(0);
    expect(unreadable.output).toBe("");
    const short = await runResolve({ EVENT_NAME: "schedule" }, "abc123\trefs/heads/main");
    expect(short.exitCode).toBe(1);
    expect(short.stderr).toContain("did not resolve to an immutable commit");
  });
});
