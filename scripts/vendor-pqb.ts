/** Vendors the public-only PQB SDK adapter. Runs no upstream scripts or secret-taking generator. */
import { mkdir } from "node:fs/promises";

const PQB_APP_REVISION = "f76891fb1a67f25d5dc97afd4e23ede707cd77d1";
const target = "vendor/pqb";
const run = async (args: string[]): Promise<void> => {
  const child = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error("PQB vendor command failed");
};
await mkdir("vendor", { recursive: true });
if (!(await Bun.file(`${target}/.git/HEAD`).exists()))
  await run([
    "git",
    "clone",
    "--filter=blob:none",
    "--no-checkout",
    "https://github.com/starknet-innovation/qsb-app.git",
    target,
  ]);
await run([
  "git",
  "-C",
  target,
  "sparse-checkout",
  "set",
  "--no-cone",
  "/src/pqb-core/",
  "/src/lib/pqb.ts",
  "/src/lib/model.ts",
]);
await run(["git", "-C", target, "fetch", "origin", PQB_APP_REVISION]);
await run(["git", "-C", target, "checkout", "--detach", PQB_APP_REVISION]);
const result = await Bun.build({
  entrypoints: ["scripts/pqb-sdk-entry.js"],
  outdir: "vendor/pqb-built",
  naming: "sdk.mjs",
  target: "browser",
  minify: true,
});
if (!result.success) throw new AggregateError(result.logs, "PQB public adapter build failed");
