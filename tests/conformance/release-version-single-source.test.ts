/**
 * The release-version gate (issue #59): the tag, artifact, and changelog must
 * all derive from one version, and any drift must fail the release. These are
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
  isHotfixBranch,
  main,
  resolveSingleSourceVersion,
  tagForVersion,
  versionFromReleaseBranch,
} from "../../scripts/release-version";

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

describe("versionFromReleaseBranch", () => {
  test("derives X.Y.0 from a release/vX.Y branch", () => {
    expect(versionFromReleaseBranch("release/v0.5")).toBe("0.5.0");
    expect(versionFromReleaseBranch("release/v1.12")).toBe("1.12.0");
  });

  test("derives X.Y.Z from a release/vX.Y.Z patch branch (issue #302)", () => {
    expect(versionFromReleaseBranch("release/v0.5.1")).toBe("0.5.1");
    expect(versionFromReleaseBranch("release/v0.10.12")).toBe("0.10.12");
  });

  test("rejects names that are not release branches", () => {
    expect(versionFromReleaseBranch("release/v0.5.1.2")).toBeNull();
    expect(versionFromReleaseBranch("release/v0.10-save-orphan")).toBeNull();
    expect(versionFromReleaseBranch("feature/59-x")).toBeNull();
    expect(versionFromReleaseBranch("hotfix/panic")).toBeNull();
    expect(versionFromReleaseBranch("main")).toBeNull();
  });
});

describe("isHotfixBranch / tagForVersion", () => {
  test("recognizes hotfix branches only", () => {
    expect(isHotfixBranch("hotfix/vault-decrypt")).toBe(true);
    expect(isHotfixBranch("release/v0.5")).toBe(false);
  });

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

  test("cuts a release when the release branch matches the version", () => {
    const evaluation = evaluateRelease({ ...sources, headRef: "release/v0.5" });
    expect(evaluation.ok).toBe(true);
    if (evaluation.ok) {
      expect(evaluation.result).toMatchObject({
        version: "0.5.0",
        tag: "v0.5.0",
        release: true,
        kind: "release",
      });
    }
  });

  test("FAILS when the release branch implies a different version than the sources", () => {
    // The exact v0.4.0-shipped-as-0.3.0 failure: release/v0.4 but package/manifest still 0.3.0.
    const evaluation = evaluateRelease({
      packageVersion: "0.3.0",
      manifestVersion: "0.3.0",
      headRef: "release/v0.4",
    });
    expect(evaluation.ok).toBe(false);
    if (!evaluation.ok) {
      expect(evaluation.problems[0]).toContain("release branch release/v0.4 implies version 0.4.0");
    }
  });

  test("cuts a hotfix release from the package version", () => {
    const evaluation = evaluateRelease({
      packageVersion: "0.5.1",
      manifestVersion: "0.5.1",
      headRef: "hotfix/vault-decrypt",
    });
    expect(evaluation.ok).toBe(true);
    if (evaluation.ok) {
      expect(evaluation.result).toMatchObject({ version: "0.5.1", tag: "v0.5.1", kind: "hotfix" });
    }
  });

  test("cuts a hotfix release when its bumped tag does not yet exist", () => {
    const evaluation = evaluateRelease({
      packageVersion: "0.5.1",
      manifestVersion: "0.5.1",
      headRef: "hotfix/vault-decrypt",
      existingTags: ["v0.4.0", "v0.5.0"],
    });
    expect(evaluation.ok).toBe(true);
    if (evaluation.ok) {
      expect(evaluation.result).toMatchObject({ version: "0.5.1", tag: "v0.5.1", kind: "hotfix" });
    }
  });

  test("FAILS a hotfix promotion that forgot to bump (resolved tag already exists)", () => {
    // The false-green path: a hotfix/* is merged without bumping the version, so
    // it resolves to the already-cut v0.5.0 tag. Without this guard the workflow
    // would hit the idempotent tag-skip and go green having released nothing.
    const evaluation = evaluateRelease({
      packageVersion: "0.5.0",
      manifestVersion: "0.5.0",
      headRef: "hotfix/vault-decrypt",
      existingTags: ["v0.4.0", "v0.5.0"],
    });
    expect(evaluation.ok).toBe(false);
    if (!evaluation.ok) {
      expect(evaluation.problems[0]).toContain("tag v0.5.0 already exists");
      expect(evaluation.problems[0]).toContain("did not bump");
    }
  });

  test("does not cut a release for a chore/docs merge into main", () => {
    const evaluation = evaluateRelease({ ...sources, headRef: "chore/94-workflow" });
    expect(evaluation.ok).toBe(true);
    if (evaluation.ok) {
      expect(evaluation.result.release).toBe(false);
      expect(evaluation.result.kind).toBe("none");
    }
  });

  test("asserts the release tag carries the single-source version", () => {
    const ok = evaluateRelease({ ...sources, releaseTag: "v0.5.0" });
    expect(ok.ok).toBe(true);

    const drifted = evaluateRelease({ ...sources, releaseTag: "v0.4.0" });
    expect(drifted.ok).toBe(false);
    if (!drifted.ok) {
      expect(drifted.problems[0]).toContain("does not match the single-source version");
    }
  });

  test("surfaces source drift before any branch/tag checks", () => {
    const evaluation = evaluateRelease({
      packageVersion: "0.5.0",
      manifestVersion: "0.4.0",
      headRef: "release/v0.5",
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

  test("the checked-in version matches the v0.10 release line", async () => {
    const packageJson = await readJson("package.json");
    expect(packageJson["version"]).toBe("0.10.0");
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

  test("writes release/version/tag/kind to GITHUB_OUTPUT for a hotfix promotion", async () => {
    const outPath = await outputPath();
    const code = await main({
      HEAD_REF: "hotfix/v010-production-readiness",
      GITHUB_OUTPUT: outPath,
    });
    expect(code).toBe(0);
    const output = await readFile(outPath, "utf8");
    expect(output).toContain("release=true");
    expect(output).toContain("version=0.10.0");
    expect(output).toContain("tag=v0.10.0");
    expect(output).toContain("kind=hotfix");
  });

  test("refuses to promote the checked-in version from a stale release branch", async () => {
    const outPath = await outputPath();
    const code = await main({
      HEAD_REF: "release/v0.9",
      GITHUB_OUTPUT: outPath,
    });
    expect(code).toBe(1);
  });

  test("treats an empty HEAD_REF as no promotion (release=false)", async () => {
    const outPath = await outputPath();
    const code = await main({ HEAD_REF: "", GITHUB_OUTPUT: outPath });
    expect(code).toBe(0);
    const output = await readFile(outPath, "utf8");
    expect(output).toContain("release=false");
    expect(output).toContain("kind=none");
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
    expect(await main({ HEAD_REF: "chore/docs" })).toBe(0);
  });
});
