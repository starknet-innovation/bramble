/**
 * The release-version gate (issue #59): the tag, artifact, and changelog must
 * all derive from one version, and any drift must fail the release. These are
 * the exact checks that were missing when v0.4.0 shipped as mc-wallet-0.3.0.zip.
 *
 * The gate logic (scripts/release-version.ts) is pure, so it is exercised here
 * with fixtures. It also reads the REAL package.json and public/manifest.json to
 * prove the repository's own two mirrored sources agree — the same invariant the
 * config-standards and manifest checks enforce, asserted here from the release
 * axis so a future edit that desyncs them fails this gate too.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  evaluateRelease,
  isHotfixBranch,
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

  test("rejects names that are not release/vX.Y", () => {
    expect(versionFromReleaseBranch("release/v0.5.1")).toBeNull();
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
  test("package.json and public/manifest.json expose one agreed release version", async () => {
    const packageJson = await readJson("package.json");
    const manifestJson = await readJson("public/manifest.json");
    const result = resolveSingleSourceVersion(packageJson["version"], manifestJson["version"]);
    expect(result.ok).toBe(true);
  });

  test("the checked-in version matches the active release branch release/v0.5", async () => {
    const packageJson = await readJson("package.json");
    expect(packageJson["version"]).toBe(versionFromReleaseBranch("release/v0.5"));
  });
});
