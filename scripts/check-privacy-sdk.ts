/**
 * Verifies the official privacy SDK pin and exact browser runtime artifact.
 *
 * Provenance runs through the same `vendor-pin-policy` helpers the Krusty gate
 * uses, and the pinned commit is read back out of `scripts/vendor-privacy-sdk.ts`
 * rather than copied here: a second literal would let the verifier and the
 * vendoring step disagree about which revision was fetched. Both shipped files
 * are digest-pinned — the browser bundle that executes, and the source map the
 * build-only-dependency assertions below are read from, since `dist/` is
 * git-ignored upstream and no worktree check can see either of them.
 *
 * A digest only describes bytes that already exist, so this gate also re-derives
 * how they came to exist: the vendoring step must resolve every executable it
 * runs from a lockfile or a pinned host toolchain, and the build tool must be
 * locked with an integrity hash at the version installed on disk. Code fetched
 * by name at build time runs before this file does — with write access to the
 * checkout this file reads — so a matching digest afterwards would prove
 * nothing about the rest of the workspace.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  dynamicExecutionFailures,
  lockedPackageFailures,
  npmRunTargets,
  privacyBuildPackages,
  vendorProvenanceFailures,
  vendorRevisionPin,
} from "./vendor-pin-policy";

const checkout = "vendor/starknet-privacy";
const bundle = `${checkout}/sdk/dist/browser/starknet-sdk.min.js`;
const sourceMap = `${bundle}.map`;
const lockPath = `${checkout}/sdk/package-lock.json`;
const vendorScript = "scripts/vendor-privacy-sdk.ts";
const expectedDigest = "b3d4c41a3e8784adc4f7b5dbd069a1e7a22a27e2eb1747abe46619c1f625c9c5";
// SHA-256 of the source map emitted alongside the reviewed bundle. Its
// `sources` are repository-relative, so it is byte-reproducible wherever the
// pinned revision is built; update it only together with PRIVACY_SDK_REVISION.
const expectedSourceMapDigest = "d89b6eebee646952d5acb61232bfeb315d76f944c6749b685d039dae9f4b5e57";

for (const path of [bundle, sourceMap]) {
  if (!(await Bun.file(path).exists())) {
    throw new Error(`Privacy SDK runtime missing: ${path}; run bun run vendor:privacy`);
  }
}

const git = async (args: string[]): Promise<string> => {
  const child = Bun.spawn(["git", ...args], { cwd: checkout, stderr: "inherit", stdout: "pipe" });
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) {
    throw new Error(
      `Privacy SDK provenance unavailable: git ${args.join(" ")} failed in ${checkout}`,
    );
  }
  return output.trim();
};

const artifactDigest = async (path: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

const vendorSource = await readFile(vendorScript, "utf8");

const provenanceFailures = vendorProvenanceFailures({
  artifacts: [
    { digest: await artifactDigest(bundle), expectedDigest, path: bundle },
    {
      digest: await artifactDigest(sourceMap),
      expectedDigest: expectedSourceMapDigest,
      path: sourceMap,
    },
  ],
  head: await git(["rev-parse", "HEAD"]),
  name: "Privacy SDK",
  pinnedRevision: vendorRevisionPin(vendorSource, vendorScript, "PRIVACY_SDK_REVISION"),
  worktreeStatus: await git(["status", "--porcelain"]),
});
if (provenanceFailures.length > 0) {
  throw new Error(provenanceFailures.join("; "));
}

const installedVersion = async (name: string): Promise<string | undefined> => {
  const manifest = Bun.file(`${checkout}/sdk/node_modules/${name}/package.json`);
  if (!(await manifest.exists())) {
    return undefined;
  }
  const parsed = JSON.parse(await manifest.text()) as { readonly version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : undefined;
};

const buildTools = await Promise.all(
  privacyBuildPackages(process.platform, process.arch).map(async (name) => ({
    name,
    version: await installedVersion(name),
  })),
);
const buildFailures = [
  ...dynamicExecutionFailures(vendorSource, vendorScript),
  ...npmRunTargets(vendorSource).map(
    (target) =>
      `${vendorScript} must not run the upstream \`${target}\` package script: upstream, not this repository, chooses what it executes`,
  ),
  ...buildTools
    .filter((tool) => tool.version === undefined)
    .map((tool) => `Privacy SDK build tool is not installed from the lockfile: ${tool.name}`),
  ...lockedPackageFailures({
    lock: JSON.parse(await readFile(lockPath, "utf8")) as unknown,
    lockPath,
    packages: buildTools.flatMap((tool) =>
      tool.version === undefined ? [] : [{ name: tool.name, version: tool.version }],
    ),
  }),
];
if (buildFailures.length > 0) {
  throw new Error(buildFailures.join("; "));
}

const text = (await readFile(bundle)).toString("utf8");
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
  typeof runtime["ProvingService"] !== "function" ||
  // rc.5 renamed the sub-account surface to shadow accounts, and rc.6 made the
  // identity helpers standalone exports. The adapter consumes the builder
  // methods, but pinning the module-level helpers too means a rename that a
  // factory-only check would miss fails here instead.
  typeof runtime["shadowAccountAddress"] !== "function" ||
  typeof runtime["shadowAccountPartialCommitment"] !== "function" ||
  typeof runtime["shadowAccountCommitment"] !== "function" ||
  typeof runtime["PRIMER_CLASS_HASH"] !== "bigint"
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
  shadowAccountAnonymizerAddress: "0x3",
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
const shadowAccounts = builder.shadowAccounts("smoke");
if (
  typeof shadowAccounts !== "object" ||
  shadowAccounts === null ||
  typeof shadowAccounts.partialCommitment !== "function" ||
  typeof shadowAccounts.commitment !== "function" ||
  typeof shadowAccounts.invoke !== "function"
) {
  throw new Error("Privacy SDK builder no longer exposes the reviewed shadow-account interface");
}
