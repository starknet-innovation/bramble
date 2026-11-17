/**
 * Runs the real `check-file-standards` gate over throwaway fixture trees to
 * prove a shipped JavaScript module is held to the same security rules as
 * TypeScript (Sherlock 235). The ledger-browser transport ships two `.js`
 * modules that sit outside `tsc`, so this gate is the only check on them; a
 * rule guarded by a `.ts` extension test would let them through.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const CHECKER = join(REPO_ROOT, "scripts/check-file-standards.ts");
// Same git-ignored fixture parent as the secret-material checker test, which
// the gate itself skips.
const FIXTURE_PARENT = join(REPO_ROOT, "output");
const MODULE = "packages/platform/ledger-browser/src/fixture.js";
const DECLARATION = "packages/platform/ledger-browser/src/fixture.d.ts";
const fixtureRoots: string[] = [];
// The banned calls are assembled from pieces so this file does not itself
// contain what the gate rejects.
const EVAL = ["ev", "al"].join("");
const STORAGE = ["chrome", "storage"].join(".");
const WILDCARD = ["post", "Message"].join("");

const runChecker = async (files: Readonly<Record<string, string>>) => {
  await mkdir(FIXTURE_PARENT, { recursive: true });
  const root = await mkdtemp(join(FIXTURE_PARENT, "file-standards-js-"));
  fixtureRoots.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const run = Bun.spawnSync([process.execPath, "run", "--no-install", CHECKER], { cwd: root });
  return { exitCode: run.exitCode, stderr: run.stderr.toString() };
};

const declared = (source: string): Readonly<Record<string, string>> => ({
  [DECLARATION]:
    "/** Fixture declarations. */\n/** Does nothing. */\nexport function noop(): void;\n",
  [MODULE]: source,
});

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("check-file-standards on production JavaScript modules", () => {
  test("accepts a clean module whose API is declared in a sibling .d.ts", async () => {
    const { exitCode, stderr } = await runChecker(
      declared("/** Fixture module. */\nexport const noop = () => undefined;\n"),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  const rules: ReadonlyArray<readonly [string, string, string]> = [
    [
      "dynamic code",
      `const run = (code) => ${EVAL}(code);\nvoid run;\n`,
      "must not use eval-style dynamic code execution",
    ],
    [
      "a wildcard postMessage target",
      `const send = (target) => target.${WILDCARD}({ ready: true }, "*");\nvoid send;\n`,
      "must not use wildcard postMessage targets",
    ],
    [
      "a string-HTML sink",
      'const paint = (node) => {\n  node.innerHTML = "<b>x</b>";\n};\nvoid paint;\n',
      "must not render string HTML",
    ],
    [
      "secret material outside the boundary",
      "const reach = (holder) => holder.readVault();\nvoid reach;\n",
      "must keep secret material in approved boundary modules",
    ],
    [
      "direct browser storage",
      `const read = () => ${STORAGE}.local.get();\nvoid read;\n`,
      "must use the storage adapter",
    ],
  ];

  for (const [name, body, rejection] of rules) {
    test(`rejects ${name}`, async () => {
      const { exitCode, stderr } = await runChecker(declared(`/** Fixture module. */\n${body}`));
      expect(exitCode).toBe(1);
      expect(stderr).toContain(`${MODULE} ${rejection}`);
    });
  }

  test("rejects a module that does not start with a doc comment", async () => {
    const { exitCode, stderr } = await runChecker(
      declared("export const noop = () => undefined;\n"),
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`${MODULE} must start with a doc comment`);
  });

  test("rejects a module with no sibling declaration file", async () => {
    const { exitCode, stderr } = await runChecker({
      [MODULE]: "/** Fixture module. */\nexport const noop = () => undefined;\n",
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`${MODULE} must declare and document its API in a sibling .d.ts`);
  });

  test("leaves non-source JavaScript to the generic rules", async () => {
    const { exitCode, stderr } = await runChecker({
      "apps/website/src/widget.js": `const run = (code) => ${EVAL}(code);\nvoid run;\n`,
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
