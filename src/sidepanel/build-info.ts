/**
 * Build-stamped extension identity shown on the settings screen.
 *
 * `scripts/build-extension.ts` injects both constants at bundle time: the
 * manifest version, and the git branch the bundle was built from (empty for
 * released builds, i.e. `main` or a detached tag checkout). Outside a built
 * bundle — unit tests and type-checking — the constants are absent and both
 * fields fall back to empty strings, which hides the corresponding UI line.
 * Display-only strings; never used for logic, storage, or requests.
 */

declare const __MC_BUILD_VERSION__: string | undefined;
declare const __MC_BUILD_BRANCH__: string | undefined;

/**
 * Version and source branch stamped into the bundle at build time.
 */
export type BuildInfo = {
  readonly branch: string;
  readonly version: string;
};

/**
 * Reads the build stamp injected by the extension build, or empty strings
 * when running unbundled (tests, type-checking). Never throws.
 */
export const buildInfo = (): BuildInfo => ({
  branch: typeof __MC_BUILD_BRANCH__ === "string" ? __MC_BUILD_BRANCH__ : "",
  version: typeof __MC_BUILD_VERSION__ === "string" ? __MC_BUILD_VERSION__ : "",
});
