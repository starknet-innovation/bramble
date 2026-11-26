/**
 * Single source of truth for the release version, and the gate that keeps the
 * release tag and artifact from drifting away from it (issue #59).
 *
 * The release version is defined once in `package.json` (`version`);
 * `apps/extension/public/manifest.json` mirrors it and `check-config-standards` /
 * `check-extension-manifest` already forbid the two from diverging. What was
 * missing — and why `v0.4.0` shipped as `mc-wallet-0.3.0.zip` — is a gate tying
 * the *tag* to that value. Releases are cut from `main` by pushing `vX.Y.Z` on
 * the commit that bumped the version, and `evaluateRelease` is the gate the
 * release build runs: given the package and manifest versions and the tag, it
 * derives the one canonical version and refuses any mismatch.
 *
 * The exported functions are PURE (no I/O) so they can be unit tested without a
 * checkout or a git remote; only `main()` reads `package.json` /
 * `apps/extension/public/manifest.json` and writes `GITHUB_OUTPUT`.
 */
import { readFile } from "node:fs/promises";

/** A release version string, `X.Y.Z`. */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

/** A resolved release: the canonical version and the tag that must carry it. */
export interface GateResult {
  readonly version: string;
  readonly tag: string;
}

/** Outcome of the gate: either a resolved release, or the reasons it is invalid. */
export type ReleaseEvaluation =
  | { readonly ok: true; readonly result: GateResult }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Inputs to {@link evaluateRelease}. Version fields are `unknown` because they come from parsed JSON. */
export interface GateInput {
  readonly packageVersion: unknown;
  readonly manifestVersion: unknown;
  /** The tag being released, when asserting it on the build path. */
  readonly releaseTag?: string | undefined;
}

/** The tag that must carry a given version. */
export const tagForVersion = (version: string): string => `v${version}`;

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
      `apps/extension/public/manifest.json version must be X.Y.Z (got ${JSON.stringify(manifestVersion)})`,
    );
  }
  if (problems.length === 0 && packageVersion !== manifestVersion) {
    problems.push(
      `package.json (${String(packageVersion)}) and apps/extension/public/manifest.json (${String(manifestVersion)}) versions must match`,
    );
  }
  return problems.length === 0
    ? { ok: true, version: packageVersion as string }
    : { ok: false, problems };
};

/**
 * The release gate. Derives the one canonical version from the mirrored
 * sources and — if a tag is supplied — asserts the tag carries exactly that
 * version. Any drift is returned as a problem rather than silently accepted.
 */
export const evaluateRelease = (input: GateInput): ReleaseEvaluation => {
  const single = resolveSingleSourceVersion(input.packageVersion, input.manifestVersion);
  if (!single.ok) {
    return { ok: false, problems: single.problems };
  }
  const { version } = single;
  const tag = tagForVersion(version);
  if (input.releaseTag !== undefined && input.releaseTag !== tag) {
    return {
      ok: false,
      problems: [
        `tag ${input.releaseTag} does not match the single-source version ${version} (expected ${tag})`,
      ],
    };
  }
  return { ok: true, result: { version, tag } };
};

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

/**
 * CLI entrypoint. Reads the mirrored versions, applies the gate to
 * `RELEASE_TAG` from the environment (the release build sets it), writes
 * `version`/`tag` to `GITHUB_OUTPUT` when present, and exits non-zero on any
 * drift. Returns the process exit code.
 */
export const main = async (
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> => {
  const packageJson = await readJson("package.json");
  const manifestJson = await readJson("apps/extension/public/manifest.json");
  const evaluation = evaluateRelease({
    packageVersion: packageJson["version"],
    manifestVersion: manifestJson["version"],
    releaseTag: env["RELEASE_TAG"] === "" ? undefined : env["RELEASE_TAG"],
  });

  if (!evaluation.ok) {
    for (const problem of evaluation.problems) {
      console.error(`release-version: ${problem}`);
    }
    return 1;
  }

  const { result } = evaluation;
  console.log(`release-version: version ${result.version}, tag ${result.tag}`);

  const outputPath = env["GITHUB_OUTPUT"];
  if (outputPath !== undefined && outputPath !== "") {
    const existing = await Bun.file(outputPath)
      .text()
      .catch(() => "");
    await Bun.write(
      Bun.file(outputPath),
      `${existing}version=${result.version}\ntag=${result.tag}\n`,
    );
  }
  return 0;
};

if (import.meta.main) {
  process.exit(await main());
}
