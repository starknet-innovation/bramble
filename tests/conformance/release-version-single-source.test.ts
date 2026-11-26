/**
 * The release-version gate (issue #59): the release tag and artifact must
 * derive from one version, and any drift must fail the release. These are
 * the exact checks that were missing when v0.4.0 shipped as mc-wallet-0.3.0.zip.
 *
 * The gate logic (scripts/release-version.ts) is pure, so it is exercised here
 * with fixtures. It also reads the real package and extension manifest files to
 * prove the repository's own two mirrored sources agree — the same invariant the
 * config-standards and manifest checks enforce, asserted here from the release
 * axis so a future edit that desyncs them fails this gate too.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateRelease,
  main,
  resolveSingleSourceVersion,
  tagForVersion,
} from "../../scripts/release-version";

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

describe("tagForVersion", () => {
  test("prefixes the tag with v", () => {
    expect(tagForVersion("0.5.0")).toBe("v0.5.0");
  });
});

describe("resolveSingleSourceVersion", () => {
  test("returns the version when both sources agree", () => {
    const result = resolveSingleSourceVersion("0.5.0", "0.5.0");
    expect(result).toEqual({ ok: true, version: "0.5.0" });
  });

  test("reports drift between the two sources", () => {
    const result = resolveSingleSourceVersion("0.4.0", "0.3.0");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0]).toContain("must match");
    }
  });

  test("rejects a non-semver version", () => {
    const result = resolveSingleSourceVersion("0.5", "0.5");
    expect(result.ok).toBe(false);
  });
});

describe("evaluateRelease", () => {
  const sources = { packageVersion: "0.5.0", manifestVersion: "0.5.0" } as const;

  test("resolves the version and tag from the agreed sources", () => {
    const evaluation = evaluateRelease(sources);
    expect(evaluation).toEqual({ ok: true, result: { version: "0.5.0", tag: "v0.5.0" } });
  });

  test("asserts the release tag carries the single-source version", () => {
    const ok = evaluateRelease({ ...sources, releaseTag: "v0.5.0" });
    expect(ok.ok).toBe(true);

    // The v0.4.0-shipped-as-0.3.0 failure: a tag pushed on a commit whose
    // package/manifest were never bumped.
    const drifted = evaluateRelease({ ...sources, releaseTag: "v0.4.0" });
    expect(drifted.ok).toBe(false);
    if (!drifted.ok) {
      expect(drifted.problems[0]).toContain("does not match the single-source version");
    }
  });

  test("rejects a tag that is not exactly vX.Y.Z of the version", () => {
    for (const tag of ["0.5.0", "v0.5.0-rc.1", "v0.5", "release/v0.5"]) {
      expect(evaluateRelease({ ...sources, releaseTag: tag }).ok).toBe(false);
    }
  });

  test("surfaces source drift before the tag check", () => {
    const evaluation = evaluateRelease({
      packageVersion: "0.5.0",
      manifestVersion: "0.4.0",
      releaseTag: "v0.5.0",
    });
    expect(evaluation.ok).toBe(false);
  });
});

describe("repository sources", () => {
  test("package.json and the extension manifest expose one agreed release version", async () => {
    const packageJson = await readJson("package.json");
    const manifestJson = await readJson("apps/extension/public/manifest.json");
    const result = resolveSingleSourceVersion(packageJson["version"], manifestJson["version"]);
    expect(result.ok).toBe(true);
  });

  test("the checked-in version matches the v0.10.11 release line", async () => {
    const packageJson = await readJson("package.json");
    expect(packageJson["version"]).toBe("0.10.11");
  });
});

describe("main (CLI over the real repository sources)", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  const outputPath = async (): Promise<string> => {
    dir = await mkdtemp(join(tmpdir(), "release-version-test-"));
    return join(dir, "github_output");
  };

  test("writes version/tag to GITHUB_OUTPUT for the matching release tag", async () => {
    const outPath = await outputPath();
    const code = await main({ RELEASE_TAG: "v0.10.11", GITHUB_OUTPUT: outPath });
    expect(code).toBe(0);
    const output = await readFile(outPath, "utf8");
    expect(output).toBe("version=0.10.11\ntag=v0.10.11\n");
  });

  test("treats an empty RELEASE_TAG as no tag to assert", async () => {
    const outPath = await outputPath();
    expect(await main({ RELEASE_TAG: "", GITHUB_OUTPUT: outPath })).toBe(0);
  });

  test("exits non-zero when the release tag drifts from the single-source version", async () => {
    const outPath = await outputPath();
    const code = await main({ RELEASE_TAG: "v0.4.0", GITHUB_OUTPUT: outPath });
    expect(code).toBe(1);
    // The gate fails before any output is written, so nothing is emitted.
    const written = await readFile(outPath, "utf8").catch(() => null);
    expect(written).toBeNull();
  });

  test("succeeds without a GITHUB_OUTPUT target", async () => {
    expect(await main({ RELEASE_TAG: "v0.10.11" })).toBe(0);
  });
});
