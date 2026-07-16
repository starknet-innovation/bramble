/**
 * Single source of truth for the release version, and the gate that keeps the
 * tag, artifact, and changelog from drifting away from it (issue #59).
 *
 * The release version is defined once in `package.json` (`version`);
 * `public/manifest.json` mirrors it and `check-config-standards` /
 * `check-extension-manifest` already forbid the two from diverging. What was
 * missing — and why `v0.4.0` shipped as `mc-wallet-0.3.0.zip` — is a gate tying
 * the *tag* to that value. `evaluateRelease` is that gate: given the package and
 * manifest versions, the merged head branch, and (on the release path) the tag,
 * it derives the one canonical version and refuses any mismatch.
 *
 * The exported functions are PURE (no I/O) so they can be unit tested without a
 * checkout or a git remote; only `main()` reads `package.json` /
 * `public/manifest.json` and writes `GITHUB_OUTPUT`.
 */
import { readFile } from "node:fs/promises";

/** A release version string, `X.Y.Z`. */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

/** A release branch, `release/vX.Y` (no patch component — it covers the line). */
export const RELEASE_BRANCH = /^release\/v(\d+)\.(\d+)$/;

/** A hotfix branch, `hotfix/<desc>`. */
export const HOTFIX_BRANCH = /^hotfix\/.+/;

/** How a promotion into `main` maps to a release: from a release or a hotfix branch, or not at all. */
export type ReleaseKind = "release" | "hotfix" | "none";

/** A resolved release: the canonical version and the tag that must carry it. */
export interface GateResult {
  readonly version: string;
  readonly tag: string;
  readonly release: boolean;
  readonly kind: ReleaseKind;
  readonly notes: readonly string[];
}

/** Outcome of the gate: either a resolved release, or the reasons it is invalid. */
export type ReleaseEvaluation =
  | { readonly ok: true; readonly result: GateResult }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Inputs to {@link evaluateRelease}. Version fields are `unknown` because they come from parsed JSON. */
export interface GateInput {
  readonly packageVersion: unknown;
  readonly manifestVersion: unknown;
  /** The merged head branch, when resolving an auto-release on a push to `main`. */
  readonly headRef?: string | undefined;
  /** The tag being released, when asserting it on the build path. */
  readonly releaseTag?: string | undefined;
}

/** The tag that must carry a given version. */
export const tagForVersion = (version: string): string => `v${version}`;

/** The `X.Y.0` version a `release/vX.Y` branch cuts, or `null` if the name does not match. */
export const versionFromReleaseBranch = (branch: string): string | null => {
  const match = RELEASE_BRANCH.exec(branch);
  return match ? `${match[1]}.${match[2]}.0` : null;
};

/** Whether a branch is a hotfix promotion. */
export const isHotfixBranch = (branch: string): boolean => HOTFIX_BRANCH.test(branch);

/**
 * Resolves the single release version from the two mirrored sources. Returns the
 * version when they agree and are `X.Y.Z`, otherwise every reason they do not.
 */
export const resolveSingleSourceVersion = (
  packageVersion: unknown,
  manifestVersion: unknown,
):
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly problems: readonly string[] } => {
  const problems: string[] = [];
  if (typeof packageVersion !== "string" || !RELEASE_VERSION.test(packageVersion)) {
    problems.push(`package.json version must be X.Y.Z (got ${JSON.stringify(packageVersion)})`);
  }
  if (typeof manifestVersion !== "string" || !RELEASE_VERSION.test(manifestVersion)) {
    problems.push(
      `public/manifest.json version must be X.Y.Z (got ${JSON.stringify(manifestVersion)})`,
    );
  }
  if (problems.length === 0 && packageVersion !== manifestVersion) {
    problems.push(
      `package.json (${String(packageVersion)}) and public/manifest.json (${String(manifestVersion)}) versions must match`,
    );
  }
  return problems.length === 0
    ? { ok: true, version: packageVersion as string }
    : { ok: false, problems };
};

/**
 * The release gate. Derives the one canonical version from the mirrored sources,
 * then — if a merged head branch is supplied — decides whether the push is a
 * release/hotfix promotion and cross-checks the branch-implied version against
 * it, and — if a tag is supplied — asserts the tag carries exactly that version.
 * Any drift is returned as a problem rather than silently accepted.
 */
export const evaluateRelease = (input: GateInput): ReleaseEvaluation => {
  const single = resolveSingleSourceVersion(input.packageVersion, input.manifestVersion);
  if (!single.ok) {
    return { ok: false, problems: single.problems };
  }

  const { version } = single;
  const problems: string[] = [];
  const notes: string[] = [];
  let release = false;
  let kind: ReleaseKind = "none";

  if (input.headRef !== undefined) {
    const branchVersion = versionFromReleaseBranch(input.headRef);
    if (branchVersion !== null) {
      release = true;
      kind = "release";
      if (branchVersion !== version) {
        problems.push(
          `release branch ${input.headRef} implies version ${branchVersion} but package/manifest is ${version}; bump package.json and public/manifest.json to ${branchVersion} before promoting`,
        );
      }
    } else if (isHotfixBranch(input.headRef)) {
      release = true;
      kind = "hotfix";
      notes.push(`hotfix promotion ${input.headRef}: releasing package version ${version}`);
    } else {
      notes.push(`head ${input.headRef} is not a release/hotfix promotion; no release will be cut`);
    }
  }

  const tag = tagForVersion(version);
  if (input.releaseTag !== undefined && input.releaseTag !== tag) {
    problems.push(
      `tag ${input.releaseTag} does not match the single-source version ${version} (expected ${tag})`,
    );
  }

  return problems.length === 0
    ? { ok: true, result: { version, tag, release, kind, notes } }
    : { ok: false, problems };
};

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

/**
 * CLI entrypoint. Reads the mirrored versions, applies the gate to the
 * environment (`HEAD_REF` on the auto-release path, `RELEASE_TAG` on the build
 * path), writes `release`/`version`/`tag`/`kind` to `GITHUB_OUTPUT` when
 * present, and exits non-zero on any drift. Returns the process exit code.
 */
export const main = async (
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> => {
  const packageJson = await readJson("package.json");
  const manifestJson = await readJson("public/manifest.json");
  const evaluation = evaluateRelease({
    packageVersion: packageJson["version"],
    manifestVersion: manifestJson["version"],
    headRef: env["HEAD_REF"] === "" ? undefined : env["HEAD_REF"],
    releaseTag: env["RELEASE_TAG"] === "" ? undefined : env["RELEASE_TAG"],
  });

  if (!evaluation.ok) {
    for (const problem of evaluation.problems) {
      console.error(`release-version: ${problem}`);
    }
    return 1;
  }

  const { result } = evaluation;
  for (const note of result.notes) {
    console.log(`release-version: ${note}`);
  }
  console.log(
    `release-version: version ${result.version}, tag ${result.tag}, release ${result.release} (${result.kind})`,
  );

  const outputPath = env["GITHUB_OUTPUT"];
  if (outputPath !== undefined && outputPath !== "") {
    const existing = await Bun.file(outputPath)
      .text()
      .catch(() => "");
    await Bun.write(
      Bun.file(outputPath),
      `${existing}release=${result.release}\nversion=${result.version}\ntag=${result.tag}\nkind=${result.kind}\n`,
    );
  }
  return 0;
};

if (import.meta.main) {
  process.exit(await main());
}
