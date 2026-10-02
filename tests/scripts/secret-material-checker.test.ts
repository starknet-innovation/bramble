/**
 * Runs the real `check-file-standards` gate over throwaway fixture trees to
 * prove the CHECKER, not just the exported constant, rejects a production
 * module that calls a session credential accessor or the vault decrypt outside
 * the approved boundary list (audit #163). A checker that drifted back to a
 * private, narrower pattern would keep `secret-material-pattern.test.ts` green
 * while letting `peekPassphrase()`, `getPassphrase()` and `readVault()` through.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { SECRET_MATERIAL_FILES } from "../../scripts/file-standards-policy";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const CHECKER = join(REPO_ROOT, "scripts/check-file-standards.ts");
// Fixture trees live in the repository's git-ignored `output/` (which the gate
// itself skips) rather than the OS temp directory: starting Bun with its cwd in
// a crowded macOS temp folder can take seconds, enough to trip the test timeout.
const FIXTURE_PARENT = join(REPO_ROOT, "output");
const ACCESSORS = ["getPassphrase", "peekPassphrase", "readVault"] as const;
const REJECTION = "must keep secret material in approved boundary modules";
const fixtureRoots: string[] = [];

// A production module that reaches the named accessor and nothing else the
// gate cares about, so the only rule it can trip is the secret-material one.
const accessorSource = (accessor: string): string =>
  `/** Fixture outside the secret boundary. */\nconst reach = (holder: Holder) => holder.${accessor}();\nvoid reach;\n`;

const runChecker = async (files: Readonly<Record<string, string>>) => {
  await mkdir(FIXTURE_PARENT, { recursive: true });
  const root = await mkdtemp(join(FIXTURE_PARENT, "file-standards-"));
  fixtureRoots.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const run = Bun.spawnSync([process.execPath, "run", "--no-install", CHECKER], { cwd: root });
  return { exitCode: run.exitCode, stderr: run.stderr.toString() };
};

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("check-file-standards secret-material rule", () => {
  test("rejects each credential accessor and the vault decrypt outside the boundary", async () => {
    const files = Object.fromEntries(
      ACCESSORS.map((accessor) => [
        `apps/extension/src/background/${accessor}-leak.ts`,
        accessorSource(accessor),
      ]),
    );
    const { exitCode, stderr } = await runChecker(files);
    expect(exitCode).toBe(1);
    for (const accessor of ACCESSORS) {
      expect(stderr).toContain(`apps/extension/src/background/${accessor}-leak.ts ${REJECTION}`);
    }
  });

  test("accepts the same reads inside an approved boundary module", async () => {
    const boundary = [...SECRET_MATERIAL_FILES].find((file) =>
      file.startsWith("apps/extension/src/"),
    );
    if (!boundary) throw new Error("no extension boundary module is approved");
    const { exitCode, stderr } = await runChecker({
      [boundary]: ACCESSORS.map(accessorSource).join(""),
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
