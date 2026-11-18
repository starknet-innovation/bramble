/**
 * The in-page provider reports the release version to dapps (#914).
 *
 * get-starknet hands `window.starknet_bramble.version` to dapps as the wallet
 * version. It once shipped as a literal "0.1.0" because the in-page bundle was
 * built without the build stamp the background and side panel get. These tests
 * pin both halves: the build passes the stamp to the in-page bundle, and the
 * provider reports the stamped manifest version.
 */
import { describe, expect, test } from "bun:test";

const INPAGE_ENTRY = "src/provider/inpage.ts";

type FakeWindow = {
  readonly addEventListener: () => void;
  readonly dispatchEvent: () => boolean;
  readonly location: { readonly origin: string };
  readonly starknet_bramble?: { readonly version: unknown };
};

const manifestVersion = async (): Promise<string> =>
  ((await Bun.file("apps/extension/public/manifest.json").json()) as { version: string }).version;

/** Returns the `Bun.build({ ... })` call in build.ts that bundles `entry`. */
const buildCallFor = async (entry: string): Promise<string> => {
  const build = await Bun.file("apps/extension/build.ts").text();
  const at = build.indexOf(`join(extensionRoot, "${entry}")`);
  expect(at).toBeGreaterThan(-1);
  const start = build.lastIndexOf("Bun.build({", at);
  return build.slice(start, build.indexOf("})", at));
};

describe("in-page provider version", () => {
  test("the in-page bundle is built with the build stamp", async () => {
    expect(await buildCallFor(INPAGE_ENTRY)).toContain("define: buildStamp");
  });

  test("the provider reports the stamped manifest version", async () => {
    const version = await manifestVersion();
    // Unbundled, the stamp and `window` resolve as globals: stand in for both.
    const scope = globalThis as { __MC_BUILD_VERSION__?: string; window?: unknown };
    const previous = scope.window;
    const page: FakeWindow = {
      addEventListener: () => undefined,
      dispatchEvent: () => true,
      location: { origin: "https://dapp.example" },
    };
    scope.__MC_BUILD_VERSION__ = version;
    scope.window = page;
    try {
      // The query gives this test its own module instance; other suites load
      // the provider too, and a cached instance would not run again. The one
      // computed load is registered in NON_LITERAL_MODULE_LOADS.
      await import(`../../apps/extension/${INPAGE_ENTRY}?stamped`);
    } finally {
      delete scope.__MC_BUILD_VERSION__;
      scope.window = previous;
    }

    expect(page.starknet_bramble?.version).toBe(version);
  });
});
