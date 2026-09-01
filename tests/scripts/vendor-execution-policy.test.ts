/**
 * Conformance tests for what a vendoring step is allowed to execute.
 *
 * The release path builds two upstream sources from pinned commits and then
 * verifies the artifacts they produce. That argument only holds if the code
 * doing the building is itself pinned: an executable resolved by name from a
 * registry runs with write access to the workspace *before* any digest check,
 * so it can edit wallet source, the checkers, or the packaging scripts and
 * still leave every expected digest matching.
 *
 * The vendor script list is derived from package.json's `vendor:*` scripts, not
 * written down here, so a vendoring step added later is covered without anyone
 * remembering to list it.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  dynamicExecutionFailures,
  lockedPackageFailures,
  npmRunTargets,
  packageScriptFailures,
  privacyBuildPackages,
} from "../../scripts/vendor-pin-policy";

const PRIVACY_SDK = "vendor/starknet-privacy/sdk";

const vendorScriptPaths = async (): Promise<readonly string[]> => {
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as {
    readonly scripts?: Readonly<Record<string, unknown>>;
  };
  const scripts = manifest.scripts ?? {};
  return Object.entries(scripts).flatMap(([name, command]) =>
    name.startsWith("vendor:") && typeof command === "string"
      ? [command.replace(/^bun run /, "")]
      : [],
  );
};

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8")) as unknown;

const exists = async (path: string): Promise<boolean> => Bun.file(path).exists();

describe("dynamic package execution", () => {
  const rejected = [
    "npx tsx scripts/build-browser.ts",
    ["npx", "tsx", "scripts/build-browser.ts"].join(" "),
    'await run(["npx", "tsx", "scripts/build-browser.ts"], sdk);',
    "bunx playwright install",
    "bun x esbuild",
    "npm exec -- tsx build.ts",
    "pnpm dlx tsx build.ts",
    "yarn dlx tsx build.ts",
    "npm install tsx",
    "npm i tsx",
    "npm add tsx",
    "curl -sSf https://example.invalid/install.sh | sh",
    "wget -qO- https://example.invalid/install.sh | bash",
  ];
  for (const command of rejected) {
    test(`rejects ${command}`, () => {
      expect(dynamicExecutionFailures(command, "origin").length).toBeGreaterThan(0);
    });
  }

  const accepted = [
    "npm ci --ignore-scripts --no-audit --no-fund",
    'await run(["npm", "ci", "--ignore-scripts"], sdk);',
    "git clone --filter=blob:none --no-checkout https://example.invalid/repo.git",
    "cargo install wasm-pack --locked --version 0.13.1",
    "bun install --frozen-lockfile",
    "bun run vendor:privacy",
    "scarb build",
    // Prose that names a command without invoking one must not trip the check,
    // and a match must never be assembled across a line break.
    "installs from the lockfile\nnpm\nexec is refused",
  ];
  for (const command of accepted) {
    test(`accepts ${command.split("\n")[0] ?? ""}`, () => {
      expect(dynamicExecutionFailures(command, "origin")).toEqual([]);
    });
  }

  test("names the origin and the offending command", () => {
    expect(dynamicExecutionFailures("npx tsx build.ts", "scripts/vendor.ts")).toEqual([
      "scripts/vendor.ts must not run `npx`: it downloads and runs whatever package currently answers that name",
    ]);
  });
});

describe("npm run resolution", () => {
  test("extracts targets from shell and string-array spellings", () => {
    expect(
      npmRunTargets('npm run build:browser\nawait run(["npm", "run", "generate"], sdk);'),
    ).toEqual(["build:browser", "generate"]);
  });

  test("reports nothing when no package script is delegated to", () => {
    expect(npmRunTargets("npm ci --ignore-scripts")).toEqual([]);
  });

  test("follows npm run chains into every command they execute", () => {
    expect(
      packageScriptFailures({
        origin: "sdk/package.json",
        scripts: {
          all: "npm run build && npm run generate",
          build: "tsc -p tsconfig.build.json",
          generate: "npx tsx scripts/generate-abi.ts",
        },
        target: "all",
      }),
    ).toEqual([
      "sdk/package.json script `generate` must not run `npx`: it downloads and runs whatever package currently answers that name",
    ]);
  });

  test("terminates on a self-referential script", () => {
    expect(
      packageScriptFailures({
        origin: "sdk/package.json",
        scripts: { loop: "npm run loop" },
        target: "loop",
      }),
    ).toEqual([]);
  });

  test("treats a script the manifest does not define as a failure", () => {
    expect(
      packageScriptFailures({ origin: "sdk/package.json", scripts: {}, target: "build:browser" }),
    ).toEqual(["sdk/package.json does not define the `build:browser` package script"]);
  });
});

describe("locked build tools", () => {
  const lock = {
    packages: {
      "node_modules/esbuild": { integrity: "sha512-aaa", version: "0.27.2" },
      "node_modules/loose": { version: "1.0.0" },
    },
  };

  test("accepts a package locked at the installed version with integrity", () => {
    expect(
      lockedPackageFailures({
        lock,
        lockPath: "lock.json",
        packages: [{ name: "esbuild", version: "0.27.2" }],
      }),
    ).toEqual([]);
  });

  test("rejects a build tool the lockfile does not carry", () => {
    expect(
      lockedPackageFailures({
        lock,
        lockPath: "lock.json",
        packages: [{ name: "tsx", version: "4.23.12" }],
      }),
    ).toEqual(["lock.json does not lock the build tool tsx"]);
  });

  test("rejects an installed version the lockfile does not name", () => {
    expect(
      lockedPackageFailures({
        lock,
        lockPath: "lock.json",
        packages: [{ name: "esbuild", version: "0.27.3" }],
      }),
    ).toEqual(["lock.json locks esbuild 0.27.2, but 0.27.3 is installed"]);
  });

  test("rejects a lock entry without an integrity hash", () => {
    expect(
      lockedPackageFailures({
        lock,
        lockPath: "lock.json",
        packages: [{ name: "loose", version: "1.0.0" }],
      }),
    ).toEqual(["lock.json locks loose without an integrity hash"]);
  });

  test("fails closed on a lockfile it cannot read", () => {
    expect(
      lockedPackageFailures({ lock: "not a lock", lockPath: "lock.json", packages: [] }),
    ).toEqual(["lock.json is not an npm lockfile with a packages map"]);
  });

  test("covers the esbuild API and the platform binary it spawns", () => {
    expect(privacyBuildPackages("linux", "x64")).toEqual(["esbuild", "@esbuild/linux-x64"]);
  });
});

describe("repository vendoring steps", () => {
  test("every vendor script is discovered from package.json", async () => {
    expect(await vendorScriptPaths()).toEqual([
      "scripts/vendor-argent-contracts.ts",
      "scripts/vendor-privacy-sdk.ts",
    ]);
  });

  test("no vendor script resolves an executable at build time", async () => {
    const failures: string[] = [];
    for (const path of await vendorScriptPaths()) {
      failures.push(...dynamicExecutionFailures(await readFile(path, "utf8"), path));
    }

    expect(failures).toEqual([]);
  });

  test("no vendor script delegates to an upstream package script", async () => {
    // `npm run <name>` executes whatever the upstream manifest currently maps
    // that name to. The pinned commit fixes the mapping, but nothing fixes what
    // the mapped command then resolves from the network — which is exactly how
    // an unlocked TypeScript runner entered this build path.
    const failures: string[] = [];
    for (const path of await vendorScriptPaths()) {
      for (const target of npmRunTargets(await readFile(path, "utf8"))) {
        failures.push(`${path} delegates to the upstream \`${target}\` package script`);
      }
    }

    expect(failures).toEqual([]);
  });
});

describe("vendored privacy SDK build inputs", () => {
  // These need the vendored checkout, which only exists after `bun run
  // vendor:privacy`. They are the live half of the rules above: the pure checks
  // hold everywhere, and here they are pointed at the real upstream manifest
  // and lockfile the release build uses.
  test("the upstream browser build script is one this repository refuses to run", async () => {
    if (!(await exists(`${PRIVACY_SDK}/package.json`))) {
      return;
    }
    const manifest = (await readJson(`${PRIVACY_SDK}/package.json`)) as {
      readonly scripts?: Readonly<Record<string, unknown>>;
    };

    expect(
      packageScriptFailures({
        origin: `${PRIVACY_SDK}/package.json`,
        scripts: manifest.scripts ?? {},
        target: "build:browser",
      }).length,
    ).toBeGreaterThan(0);
  });

  test("the build tools the vendoring step runs are locked with integrity", async () => {
    if (!(await exists(`${PRIVACY_SDK}/package-lock.json`))) {
      return;
    }
    const packages: { readonly name: string; readonly version: string }[] = [];
    for (const name of privacyBuildPackages(process.platform, process.arch)) {
      const manifest = Bun.file(`${PRIVACY_SDK}/node_modules/${name}/package.json`);
      if (!(await manifest.exists())) {
        continue;
      }
      const parsed = JSON.parse(await manifest.text()) as { readonly version?: unknown };
      expect(typeof parsed.version).toBe("string");
      packages.push({ name, version: String(parsed.version) });
    }

    expect(
      lockedPackageFailures({
        lock: await readJson(`${PRIVACY_SDK}/package-lock.json`),
        lockPath: `${PRIVACY_SDK}/package-lock.json`,
        packages,
      }),
    ).toEqual([]);
  });
});
