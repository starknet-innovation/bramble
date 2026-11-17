/**
 * Guards the only link between the build's `define` map and the code that
 * reads it.
 *
 * A stamped constant is spelled twice — once as a key in `buildStamp` in
 * `apps/extension/build.ts`, once as a `declare const` in the module that reads
 * it — and nothing in TypeScript connects the two. A typo on either side is
 * invisible: the identifier simply stays undefined at runtime and the reader
 * silently takes its fallback branch.
 *
 * That is not cosmetic for `__MC_BUILD_TARGET__`. It is what tells the Firefox
 * bundle that this browser cannot restrict storage access; unstamped, the
 * Firefox build fails its startup lockdown and the extension refuses to launch.
 * It fails closed, which is the right direction, but nothing else would notice.
 */
import { describe, expect, test } from "bun:test";

const STAMP = /__MC_BUILD_[A-Z_]+__/g;

const uniqueMatches = (text: string, pattern: RegExp): readonly string[] => [
  ...new Set(text.match(pattern) ?? []),
];

const definedStamps = async (): Promise<readonly string[]> => {
  const build = await Bun.file("apps/extension/build.ts").text();
  const stamp = build.slice(
    build.indexOf("const buildStamp = {"),
    build.indexOf("};", build.indexOf("const buildStamp = {")),
  );
  return [...uniqueMatches(stamp, STAMP)].sort();
};

const declaredStamps = async (): Promise<readonly string[]> => {
  const declared = new Set<string>();
  for (const root of ["apps", "packages"]) {
    for await (const path of new Bun.Glob(`${root}/**/src/**/*.ts`).scan(".")) {
      const text = await Bun.file(path).text();
      for (const [, name] of text.matchAll(/declare const (__MC_BUILD_[A-Z_]+__)/g)) {
        if (name !== undefined) {
          declared.add(name);
        }
      }
    }
  }
  return [...declared].sort();
};

describe("build stamp single source", () => {
  test("every stamp the build defines is declared by a reader, and vice versa", async () => {
    const defined = await definedStamps();
    expect(defined.length).toBeGreaterThan(0);
    expect(await declaredStamps()).toEqual([...defined]);
  });

  test("the build target is one of them", async () => {
    expect(await definedStamps()).toContain("__MC_BUILD_TARGET__");
  });
});
