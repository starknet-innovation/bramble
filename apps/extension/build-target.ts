/**
 * The browsers this extension is built for, where each build is written, and
 * how a command line names them.
 *
 * Kept in its own module because the build, the packaging script, and the
 * manifest gate all need to agree on the target names and output directories;
 * a second spelling of "dist-firefox" is exactly the drift that would package
 * one browser's bundle under another's manifest. The argument parsing lives
 * here rather than in `build.ts` for the same reason it is pure: a top-level
 * build script cannot be imported, so parsing written there could not be
 * tested, and "no flag means Chrome" is a promise every existing caller
 * depends on.
 */
import { FIREFOX_NAME_LIMIT } from "./firefox-manifest";

/** Every supported build target. `chrome` is the default and covers Chromium. */
export const BUILD_TARGETS = ["chrome", "firefox"] as const;

/** One supported build target. */
export type BuildTarget = (typeof BUILD_TARGETS)[number];

/**
 * Repository-relative output directory for a target. Chrome keeps `dist/` so
 * every existing consumer — the E2E suite, `dev:session`, unpacked loads, and
 * the release pipeline — is unaffected by Firefox existing.
 */
export const outputDirectory = (target: BuildTarget): string =>
  target === "firefox" ? "dist-firefox" : "dist";

/** Longest `name` the Chrome Web Store accepts. */
export const CHROME_NAME_LIMIT = 75;

/**
 * Longest `name` each store accepts, for the development stamp that appends a
 * branch to it. addons.mozilla.org rejects a submission whose name exceeds
 * {@link FIREFOX_NAME_LIMIT}, so the Gecko target is cut harder than Chromium.
 * The Firefox bound is imported rather than repeated: `toFirefoxManifest`
 * checks the unstamped name against it and this trims the stamped one, and two
 * literals would eventually disagree about which build AMO accepts. Release
 * builds are far below both.
 */
export const nameLimit = (target: BuildTarget): number =>
  target === "firefox" ? FIREFOX_NAME_LIMIT : CHROME_NAME_LIMIT;

/** Flag that selects a build target, e.g. `--target=firefox`. */
const TARGET_FLAG = "--target=";

const isBuildTarget = (value: string): value is BuildTarget =>
  (BUILD_TARGETS as readonly string[]).includes(value);

const expandTarget = (value: string): readonly BuildTarget[] => {
  if (value === "all") {
    return BUILD_TARGETS;
  }
  if (!isBuildTarget(value)) {
    throw new Error(`unknown build target ${value}; expected ${BUILD_TARGETS.join(", ")} or all`);
  }
  return [value];
};

/**
 * Reads the targets an argument list asks for.
 *
 * No `--target=` flag means Chrome alone, so every existing caller — CI,
 * `dev:session`, the E2E suite, a bare `bun run build` — keeps writing exactly
 * `dist/`. `all` expands to every target, repeated flags accumulate, and the
 * result is deduplicated: a target named twice would otherwise be emitted
 * twice concurrently into one directory, each run deleting the other's output.
 *
 * Throws on a value that is neither a target nor `all`, including the empty
 * string, rather than silently building Chrome under a misspelt flag. An
 * argument that starts with `--target` but carries no `=` is the same mistake
 * and is refused for the same reason.
 */
export const requestedTargets = (argv: readonly string[]): readonly BuildTarget[] => {
  const malformed = argv.find(
    (argument) => argument.startsWith("--target") && !argument.startsWith(TARGET_FLAG),
  );
  if (malformed !== undefined) {
    throw new Error(`malformed build target flag ${malformed}; expected ${TARGET_FLAG}<target>`);
  }
  const requested = argv
    .filter((argument) => argument.startsWith(TARGET_FLAG))
    .flatMap((argument) => expandTarget(argument.slice(TARGET_FLAG.length)));
  return requested.length === 0 ? ["chrome"] : [...new Set(requested)];
};
