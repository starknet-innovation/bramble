/**
 * Verifies the official privacy SDK pin and exact browser runtime artifact.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const revision = "722d1cfbddfc0e7d65f45084cfced08f092d2f3c";
const bundle = "vendor/starknet-privacy/sdk/dist/browser/starknet-sdk.min.js";
const sourceMap = `${bundle}.map`;
const expectedDigest = "c3ae103928707d7712ba4fe47abecfb946019da622c795b14779e7c3bc8965cc";

if (!(await Bun.file(bundle).exists())) {
  throw new Error(`Privacy SDK runtime missing: ${bundle}; run bun run vendor:privacy`);
}
const child = Bun.spawn(["git", "rev-parse", "HEAD"], {
  cwd: "vendor/starknet-privacy",
  stderr: "inherit",
  stdout: "pipe",
});
const head = (await new Response(child.stdout).text()).trim();
if ((await child.exited) !== 0 || head !== revision) {
  throw new Error("Privacy SDK checkout does not match the pinned revision");
}
const source = await readFile(bundle);
const digest = createHash("sha256").update(source).digest("hex");
if (digest !== expectedDigest) {
  throw new Error("Privacy SDK browser bundle does not match the reviewed artifact");
}
const text = source.toString("utf8");
for (const forbidden of ["child_process", "form-data", "node:fs", "starknet-devnet"]) {
  if (text.includes(forbidden)) {
    throw new Error(`Privacy SDK browser bundle contains forbidden runtime: ${forbidden}`);
  }
}
for (const required of ["createPrivateTransfers", "IndexerDiscoveryProvider", "ProvingService"]) {
  if (!text.includes(required)) {
    throw new Error(`Privacy SDK browser bundle is missing export: ${required}`);
  }
}

const map = JSON.parse(await Bun.file(sourceMap).text()) as { readonly sources?: unknown };
if (!Array.isArray(map.sources) || !map.sources.every((value) => typeof value === "string")) {
  throw new Error("Privacy SDK browser source map is malformed");
}
const vulnerableBuildPackages = [
  "@vitest",
  "axios",
  "brace-expansion",
  "decompress",
  "fast-uri",
  "form-data",
  "js-yaml",
  "postcss",
  "starknet-devnet",
  "vite",
];
for (const dependency of vulnerableBuildPackages) {
  if (map.sources.some((source) => (source as string).includes(`/node_modules/${dependency}/`))) {
    throw new Error(`Privacy SDK browser bundle includes build-only dependency: ${dependency}`);
  }
}

const runtime = (await import(pathToFileURL(resolve(bundle)).href)) as Record<string, unknown>;
const createPrivateTransfers = runtime["createPrivateTransfers"];
if (
  typeof createPrivateTransfers !== "function" ||
  typeof runtime["Open"] !== "symbol" ||
  !runtime["SetupRequirement"] ||
  typeof runtime["IndexerDiscoveryProvider"] !== "function" ||
  typeof runtime["ProvingService"] !== "function"
) {
  throw new Error("Privacy SDK browser runtime exports do not match the reviewed adapter");
}
const transfers = createPrivateTransfers({
  account: { address: "0x1", signer: {} },
  discoveryProvider: { url: "https://discovery.invalid" },
  poolContractAddress: "0x2",
  provingProvider: {
    chainId: "0x534e5f5345504f4c4941",
    nodeUrl: "https://rpc.invalid",
    url: "https://prover.invalid",
  },
  subAccountAnonymizerAddress: "0x3",
  viewingKeyProvider: { getViewingKey: async () => "0x1" },
});
if (
  typeof transfers !== "object" ||
  transfers === null ||
  !("build" in transfers) ||
  typeof transfers.build !== "function" ||
  !("discoverNotes" in transfers) ||
  typeof transfers.discoverNotes !== "function" ||
  !("discoverRequirement" in transfers) ||
  typeof transfers.discoverRequirement !== "function" ||
  !("executeWithInvocation" in transfers) ||
  typeof transfers.executeWithInvocation !== "function"
) {
  throw new Error("Privacy SDK factory no longer exposes the reviewed transfer interface");
}
const builder = transfers.build();
if (typeof builder !== "object" || builder === null || typeof builder.register !== "function") {
  throw new Error("Privacy SDK builder no longer exposes reviewed account registration");
}
