/**
 * Creates a versioned browser-extension zip from the built MV3 output.
 *
 * Pass `--target=firefox` to build and package the Gecko output instead. The
 * two packages carry the same files and differ only in their manifest (see
 * `apps/extension/firefox-manifest.ts`).
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  type BuildTarget,
  outputDirectory,
  requestedTargets,
} from "../apps/extension/build-target";
import { EXPECTED_RUNTIME_FILES, FIREFOX_RUNTIME_FILES } from "./extension-runtime-files";

// Parsed by the same strict reader the build uses, so a misspelt target, a
// space-separated `--target firefox`, or a future target this script has not
// been taught about fails loudly. An equality check here silently produced a
// Chrome-named artifact from a command that asked for something else.
const requested = requestedTargets(Bun.argv);
const [first] = requested;
if (requested.length !== 1 || first === undefined) {
  throw new Error("package one target at a time; --target=all is not packageable");
}
const target: BuildTarget = first;
const distDir = outputDirectory(target);
const expectedFiles = target === "firefox" ? FIREFOX_RUNTIME_FILES : EXPECTED_RUNTIME_FILES;
const artifactDir = "artifacts";
const reproducibleZipTime = "198001010000";

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files.sort();
};

const run = async (cmd: string[], cwd = "."): Promise<void> => {
  const child = Bun.spawn(cmd, { cwd, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed with exit code ${exitCode}`);
  }
};

await run(["bun", "run", target === "firefox" ? "build:firefox" : "build"]);
await mkdir(artifactDir, { recursive: true });

const manifest = await readJson(join(distDir, "manifest.json"));
if (typeof manifest["version"] !== "string") {
  throw new Error("dist manifest version missing");
}

const files = (await walk(distDir)).map((path) => relative(distDir, path));
if (files.join("\n") !== expectedFiles.join("\n")) {
  throw new Error(`unexpected packaged files:\n${files.join("\n")}`);
}
const zipName =
  target === "firefox"
    ? `bramble-firefox-${manifest["version"]}.zip`
    : `bramble-${manifest["version"]}.zip`;
const zipPath = resolve(artifactDir, zipName);

// Only this target's own artifacts are cleared, so packaging one browser never
// deletes the other's zip from a prior run — and `zip` appends to an archive
// that already exists, so a stale one must go before this one is written.
await rm(zipPath, { force: true });
await rm(`${zipPath}.sha256`, { force: true });

await run(["touch", "-t", reproducibleZipTime, ...files], distDir);
await run(["zip", "-X", "-q", zipPath, ...files], distDir);

const digest = createHash("sha256")
  .update(await readFile(zipPath))
  .digest("hex");
await writeFile(`${zipPath}.sha256`, `${digest}  ${zipName}\n`);
