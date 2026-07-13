/**
 * Creates a versioned browser-extension zip from the built MV3 output.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { EXPECTED_RUNTIME_FILES } from "./extension-runtime-files";

const distDir = "dist";
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

await run(["bun", "run", "build"]);
await rm(artifactDir, { force: true, recursive: true });
await mkdir(artifactDir, { recursive: true });

const manifest = await readJson(join(distDir, "manifest.json"));
if (typeof manifest["version"] !== "string") {
  throw new Error("dist manifest version missing");
}

const files = (await walk(distDir)).map((path) => relative(distDir, path));
if (files.join("\n") !== EXPECTED_RUNTIME_FILES.join("\n")) {
  throw new Error(`unexpected packaged files:\n${files.join("\n")}`);
}
const zipName = `mc-wallet-${manifest["version"]}.zip`;
const zipPath = resolve(artifactDir, zipName);

await run(["touch", "-t", reproducibleZipTime, ...files], distDir);
await run(["zip", "-X", "-q", zipPath, ...files], distDir);

const digest = createHash("sha256")
  .update(await readFile(zipPath))
  .digest("hex");
await writeFile(`${zipPath}.sha256`, `${digest}  ${zipName}\n`);
