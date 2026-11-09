/**
 * Build-target selection: where each browser's output goes, how long a name it
 * may carry, and what a command line asks for.
 *
 * These were the branch's largest blind spot. Nothing observed
 * `outputDirectory` or `nameLimit` at all, so swapping the two output
 * directories — or letting the Gecko build keep Chrome's 75-character name
 * allowance, which addons.mozilla.org rejects outright — changed no test and no
 * gate. The argument parsing lives in this module rather than in `build.ts`
 * precisely so it can be tested: a top-level build script cannot be imported.
 */
import { describe, expect, test } from "bun:test";
import {
  BUILD_TARGETS,
  CHROME_NAME_LIMIT,
  nameLimit,
  outputDirectory,
  requestedTargets,
} from "../../apps/extension/build-target";
import { FIREFOX_NAME_LIMIT } from "../../apps/extension/firefox-manifest";

describe("build output directories", () => {
  test("chrome keeps dist/, so every existing caller is unaffected", () => {
    expect(outputDirectory("chrome")).toBe("dist");
  });

  test("firefox writes somewhere else entirely", () => {
    expect(outputDirectory("firefox")).toBe("dist-firefox");
  });

  // `--target=all` emits concurrently; two targets sharing a directory would
  // mean each run deleting the other's output mid-build.
  test("no two targets share an output directory", () => {
    const directories = BUILD_TARGETS.map(outputDirectory);
    expect(new Set(directories).size).toBe(BUILD_TARGETS.length);
  });
});

describe("store name limits", () => {
  test("the firefox limit is the one addons.mozilla.org enforces", () => {
    expect(nameLimit("firefox")).toBe(FIREFOX_NAME_LIMIT);
    expect(FIREFOX_NAME_LIMIT).toBe(45);
  });

  test("chrome keeps its own, larger allowance", () => {
    expect(nameLimit("chrome")).toBe(CHROME_NAME_LIMIT);
    expect(CHROME_NAME_LIMIT).toBe(75);
  });
});

describe("requested build targets", () => {
  test("no flag means chrome alone", () => {
    expect(requestedTargets(["bun", "build.ts"])).toEqual(["chrome"]);
  });

  test("names one target", () => {
    expect(requestedTargets(["--target=firefox"])).toEqual(["firefox"]);
  });

  test("all expands to every target", () => {
    expect(requestedTargets(["--target=all"])).toEqual([...BUILD_TARGETS]);
  });

  // A target named twice would otherwise be emitted twice into one directory,
  // concurrently, each `rm -rf` racing the other's write.
  test("never returns the same target twice", () => {
    expect(requestedTargets(["--target=all", "--target=chrome", "--target=chrome"])).toEqual([
      "chrome",
      "firefox",
    ]);
  });

  test("refuses a target it does not know rather than defaulting to chrome", () => {
    expect(() => requestedTargets(["--target=safari"])).toThrow(/unknown build target safari/);
    expect(() => requestedTargets(["--target="])).toThrow(/unknown build target/);
  });

  // `--target firefox` with a space used to be ignored entirely, silently
  // building Chrome and writing dist/ when the caller asked for Gecko.
  test("refuses a target flag written without its value", () => {
    expect(() => requestedTargets(["--target", "firefox"])).toThrow(/malformed build target flag/);
  });

  test("ignores unrelated arguments", () => {
    expect(requestedTargets(["bun", "run", "build.ts", "--watch"])).toEqual(["chrome"]);
  });
});
