/**
 * Build-stamped extension identity shown on the settings screen.
 *
 * `apps/extension/build.ts` injects both constants at bundle time: the
 * manifest version, and the git branch the bundle was built from (empty for
 * released builds, i.e. `main` or a detached tag checkout). Outside a built
 * bundle — unit tests and type-checking — the constants are absent and both
 * fields fall back to empty strings, which hides the corresponding UI line.
 * Display-only strings; never used for logic, storage, or requests. The build
 * target is read separately, by `shipsAnimationRenderer`.
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

declare const __MC_BUILD_TARGET__: string | undefined;

/**
 * Whether this bundle ships `sandbox/render.html`, the only page allowed to run
 * a collectible's untrusted animation. Mirrors `shipsSandboxedRenderer` in
 * `apps/extension/firefox-manifest.ts`: the Firefox package withholds that page,
 * so a play control there would open a frame onto a missing file. Unstamped
 * bundles (tests, UI Lab) keep the control. Hiding it only removes an
 * affordance; it never loosens the sandbox.
 */
export const shipsAnimationRenderer = (
  target: string | undefined = typeof __MC_BUILD_TARGET__ === "string"
    ? __MC_BUILD_TARGET__
    : undefined,
): boolean => target !== "firefox";
