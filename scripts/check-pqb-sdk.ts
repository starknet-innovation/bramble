/** Verifies the immutable SDK source and every PQB runtime byte shipped by the extension. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  dynamicExecutionFailures,
  vendorProvenanceFailures,
  vendorRevisionPin,
} from "./vendor-pin-policy";

const vendorScript = "scripts/vendor-pqb.ts";
const digest = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const artifacts: Readonly<Record<string, string>> = {
  "scripts/pqb-sdk-prelude.js": "da6fd615f5aaab2e258a124be285194d144500c4ce582ed359e381fbdaa14a19",
  "scripts/pqb-sdk-entry.js": "2606a0a85dce6c2848fbdb8befe7d22c6517d0c28e41ef78a2ac3397e6c22a2e",
  "vendor/pqb-built/sdk.mjs": "88e611fe212fc15e3a38ff5d46e9be95526545678c794b4a1d08f9b9bbf5d43f",
  "vendor/pqb/src/pqb-core/LICENSE":
    "d13e6ac8092492ce31a7a79fb9e461ab1fd1ce667405c4c94a7d12f2d7bc9ecc",
  "vendor/pqb/src/pqb-core/THIRD_PARTY_NOTICES.md":
    "738dbf61c6ab0bed5b225deab43dd7421d53f6c7637ceb62c8f356dea57783fd",
};
const git = async (args: string[]): Promise<string> => {
  const p = Bun.spawn(["git", "-C", "vendor/pqb", ...args], { stdout: "pipe", stderr: "inherit" });
  const text = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error("PQB provenance unavailable; run bun run vendor:pqb");
  return text.trim();
};
const source = await readFile(vendorScript, "utf8");
const failures = [
  ...vendorProvenanceFailures({
    name: "PQB SDK",
    head: await git(["rev-parse", "HEAD"]),
    pinnedRevision: vendorRevisionPin(source, vendorScript, "PQB_APP_REVISION"),
    worktreeStatus: await git(["status", "--porcelain"]),
    artifacts: await Promise.all(
      Object.entries(artifacts).map(async ([path, expectedDigest]) => ({
        path,
        expectedDigest,
        digest: await digest(path),
      })),
    ),
  }),
];
failures.push(...dynamicExecutionFailures(source, vendorScript));
if (failures.length) throw new Error(failures.join("\n"));

// Load only after provenance checks. The package must expose no seed-bearing SDK API.
const sdkPath = new URL("../vendor/pqb-built/sdk.mjs", import.meta.url).href;
const sdk = (await import(sdkPath)) as import("@bramble/qsb/pqb-runtime").PqbRuntime;
if (Object.keys(sdk).sort().join(",") !== "finish,prepare,publicState,validatePublicState")
  throw new Error("Unexpected PQB SDK exports");
const vector = (await Bun.file(
  new URL("../tests/fixtures/pqb/assembly.json", import.meta.url),
).json()) as {
  readonly material: import("@bramble/wallet-model/pqb").PqbPublicMaterial;
  readonly prepared: import("@bramble/wallet-model/pqb").PqbPrepared;
  readonly witness: import("@bramble/wallet-model/pqb").PqbWitness;
  readonly publicStateJson: string;
  readonly raw: string;
};
if (
  sdk.publicState(vector.material) !== vector.publicStateJson ||
  sdk.finish(vector.material, vector.prepared, vector.witness) !== vector.raw
) {
  throw new Error("PQB public SDK does not match the independent assembly vector");
}
