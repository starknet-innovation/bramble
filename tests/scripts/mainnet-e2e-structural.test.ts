/**
 * The Mainnet E2E policy judges what GitHub will run, not the file's text.
 * Each weakening in `mainnet-e2e-policy-mutations.ts` leaves the reviewed
 * text in place (a comment, an inert string, a dead step, a respelling) and
 * was accepted by the text policy this one replaced; each must now fail.
 * Spellings that decode to the reviewed workflow must still pass, and any
 * shape the policy cannot read must fail closed.
 */
import { describe, expect, test } from "bun:test";
import { mainnetE2eWorkflowFailures } from "../../scripts/mainnet-e2e-workflow-policy";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { workflowSecurityPolicyFailures } from "../../scripts/workflow-security-policy";
import {
  DIFFERENTIAL,
  EQUIVALENT,
  FAIL_WITHOUT,
  STILL_REJECTED,
} from "./mainnet-e2e-policy-mutations";

const WORKFLOW = "mainnet-e2e.yml";
const PATH = `.github/workflows/${WORKFLOW}`;
const E = "$" + "{{";
const KEY_COUNT = `${PATH} must bind the hot-wallet private key in exactly 5 step env values, all in execute`;
const KEY_PLACE = `${PATH} must bind the hot-wallet private key only as a step env value`;
const OTHER = `${PATH} must reference secrets only in their reviewed step env bindings`;

const workflow = async (): Promise<string> => (await readWorkflowSources())[WORKFLOW] ?? "";

const mutated = (source: string, search: string, replacement: string): string => {
  expect(source).toContain(search);
  return source.replace(search, () => replacement);
};

describe("mainnet E2E policy reads the parsed workflow", () => {
  test("every weakening the text policy accepted now fails the gate", async () => {
    const sources = await readWorkflowSources();
    const source = sources[WORKFLOW] ?? "";
    for (const { item, label, search, replacement, failure } of [
      ...FAIL_WITHOUT,
      ...STILL_REJECTED,
    ]) {
      const failures = workflowSecurityPolicyFailures({
        ...sources,
        [WORKFLOW]: mutated(source, search, replacement),
      });
      if (!failures.includes(failure)) {
        throw new Error(`item ${item} accepted: ${label}\n${failures.join("\n")}`);
      }
    }
    expect(new Set(FAIL_WITHOUT.map(({ item }) => item.split(" ")[0])).size).toBe(10);
  });

  test("refuses directives and scalars another YAML reader could type differently", async () => {
    const source = await workflow();
    for (const { label, prefix, edits, failure } of DIFFERENTIAL) {
      const changed = edits.reduce(
        (text, [search, replacement]) => mutated(text, search, replacement),
        `${prefix}${source}`,
      );
      const failures = mainnetE2eWorkflowFailures(changed);
      if (!failures.includes(failure)) throw new Error(`accepted ${label}: ${failures.join("\n")}`);
    }
    // A plain decimal, a plain boolean and the root `on:` key stay accepted.
    expect(mainnetE2eWorkflowFailures(`\uFEFF# reviewed\n${source}`)).toEqual([]);
    expect(mainnetE2eWorkflowFailures(`---\n${source}`)).toEqual([]);
  });

  test("spellings that decode to the reviewed workflow still pass", async () => {
    const source = await workflow();
    for (const { label, search, replacement } of EQUIVALENT) {
      const failures = mainnetE2eWorkflowFailures(mutated(source, search, replacement));
      if (failures.length > 0) throw new Error(`rejected ${label}: ${failures.join("\n")}`);
    }
    expect(mainnetE2eWorkflowFailures(source.replaceAll("\n", "\r\n"))).toEqual([]);
  });

  test("fails closed on a document it cannot read as the reviewed shape", async () => {
    const source = await workflow();
    const order = "the resolve job must run exactly the reviewed steps, in order";
    const jobSet = `${PATH} must define exactly the jobs build, execute, gate, post, preflight, report, resolve`;
    const jobs = [order, jobSet];
    expect(mainnetE2eWorkflowFailures("[]\n")).toEqual(
      expect.arrayContaining([`${PATH} must keep the name Mainnet E2E`, ...jobs]),
    );
    const listSteps = mutated(source, "  report:\n", "  extra:\n    steps: run\n  report:\n");
    expect(mainnetE2eWorkflowFailures(listSteps)).toContain(jobSet);
    const notList = mutated(
      source,
      "    steps:\n      - name: Resolve active release branch",
      "    steps: {}\n    x-steps:\n      - name: Resolve active release branch",
    );
    expect(mainnetE2eWorkflowFailures(notList)).toEqual(
      expect.arrayContaining([
        order,
        "the resolve job must not declare x-steps",
        `${PATH} must resolve the release branch in the reviewed step`,
      ]),
    );
    const listTriggers = mutated(source, "on:\n  schedule:", "on: [push]\nx-on:\n  schedule:");
    expect(mainnetE2eWorkflowFailures(listTriggers)).toEqual(
      expect.arrayContaining([
        `${PATH} must schedule at 06:00 UTC, offset from nightly`,
        `${PATH} must allow manual dispatch with only the branch input`,
        `${PATH} must not declare workflow-level x-on`,
      ]),
    );
    const renamed = mutated(source, "name: Mainnet E2E\n", "name: Mainnet E2E (copy)\n");
    expect(mainnetE2eWorkflowFailures(renamed)).toEqual([`${PATH} must keep the name Mainnet E2E`]);
  });

  test("a script that is not a string or does not stop on errors fails every control", async () => {
    const source = await workflow();
    const step =
      '        run: |\n          set -euo pipefail\n          bundle="$RUNNER_TEMP/bundle/';
    const notString = mutated(
      source,
      step,
      '        run: [x]\n        x: |\n          bundle="$RUNNER_TEMP/bundle/',
    );
    expect(mainnetE2eWorkflowFailures(notString)).toContain(
      "mainnet execution must verify the build bundle it runs",
    );
    const lenient = mutated(
      source,
      step,
      '        run: |\n          set -uo pipefail\n          bundle="$RUNNER_TEMP/bundle/',
    );
    expect(mainnetE2eWorkflowFailures(lenient)).toEqual([
      "mainnet execution must verify the build bundle it runs",
    ]);
  });

  test("a step with an unreviewed key, or none to identify it, fails", async () => {
    const source = await workflow();
    const shell = mutated(
      source,
      "        id: secrets\n",
      "        id: secrets\n        shell: sh {0}\n",
    );
    expect(mainnetE2eWorkflowFailures(shell)).toContain(
      "mainnet execution must keep the reviewed secrets step (id, env bindings and position) that later steps depend on",
    );
    const anonymous = mutated(
      source,
      "      - name: Unpack the build\n",
      "      - run: 'true'\n      - name: Unpack the build\n",
    );
    expect(mainnetE2eWorkflowFailures(anonymous)).toContain(
      "mainnet execution must run exactly the reviewed steps, in order: no install, build or checkout, and the RPC check before any live test",
    );
    const scalar = mutated(
      source,
      "      - name: Unpack the build\n",
      "      - 7\n      - name: Unpack the build\n",
    );
    expect(mainnetE2eWorkflowFailures(scalar).length).toBeGreaterThan(0);
  });

  test("each reviewed secret binding is required, once, under its own name", async () => {
    const source = await workflow();
    const binding = `          GASLESS_E2E_PRIVATE_KEY: ${E} secrets.MAINNET_E2E_PRIVATE_KEY }}\n          GASLESS_E2E_RPC_URL: ${E} secrets.MAINNET_E2E_RPC_URL }}\n          GASLESS_E2E_NETWORK: mainnet\n        run: |\n          set -euo pipefail\n          log=`;
    const dropped = mutated(source, binding, binding.replace(/^.*PRIVATE_KEY.*\n/, ""));
    expect(mainnetE2eWorkflowFailures(dropped)).toContain(KEY_COUNT);
    const discovery = `          MAINNET_E2E_DISCOVERY_URL: ${E} secrets.MAINNET_E2E_DISCOVERY_URL }}\n`;
    expect(mainnetE2eWorkflowFailures(mutated(source, discovery, ""))).toContain(OTHER);
    const respelled = mutated(source, discovery, discovery.replace(`${E} secrets`, `${E}secrets`));
    expect(mainnetE2eWorkflowFailures(respelled)).toContain(OTHER);
    const other = mutated(
      source,
      "          BUNDLE_SHA256:",
      `          TOKEN: ${E} secrets.GITHUB_TOKEN }}\n          BUNDLE_SHA256:`,
    );
    expect(mainnetE2eWorkflowFailures(other)).toContain(OTHER);
    const inKey = mutated(
      source,
      "    env:\n      PLAYWRIGHT",
      `    env:\n      "${E} secrets.MAINNET_E2E_PRIVATE_KEY }}": x\n      PLAYWRIGHT`,
    );
    expect(mainnetE2eWorkflowFailures(inKey)).toContain(KEY_PLACE);
    const inCondition = mutated(
      source,
      "        if: vars.MAINNET_E2E_STRK20 == 'true'\n",
      "        if: secrets.MAINNET_E2E_PRIVATE_KEY != ''\n",
    );
    expect(mainnetE2eWorkflowFailures(inCondition)).toContain(KEY_PLACE);
    const build = mutated(
      source,
      `          PLAYWRIGHT_BROWSERS_PATH: ${E} github.workspace }}/.playwright-browsers\n        run: bun run test:e2e:install`,
      `          PLAYWRIGHT_BROWSERS_PATH: ${E} github.workspace }}/.playwright-browsers\n          X: ${E} secrets.MAINNET_E2E_DISCOVERY_URL }}\n        run: bun run test:e2e:install`,
    );
    expect(mainnetE2eWorkflowFailures(build)).toContain(
      "the mainnet build runs release code and must not receive any secret",
    );
  });

  test("a second step with a reviewed id cannot reuse its secret binding", async () => {
    const source = await workflow();
    const balance = `      - name: Post-run balance\n        id: balance\n        env:\n          MAINNET_E2E_ADDRESS: ${E} vars.MAINNET_E2E_ADDRESS }}\n          MAINNET_E2E_RPC_URL: ${E} secrets.MAINNET_E2E_RPC_URL }}\n`;
    const twice = mutated(source, balance, `${balance}        run: "true"\n${balance}`);
    expect(mainnetE2eWorkflowFailures(twice)).toContain(
      `${PATH} must bind the mainnet RPC URL only in its reviewed step env values`,
    );
  });
});
