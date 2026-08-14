/**
 * Verifies the production Argent release checkout and all six official account
 * artifacts. These files never ship; their class hashes authenticate the
 * already-declared Mainnet/Sepolia classes used by the wallet.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
} from "@mc-wallet/starknet/account-contracts";
import { hash } from "starknet";
import { vendorProvenanceFailures, vendorRevisionPin } from "./vendor-pin-policy";

const checkout = "vendor/argent-contracts";
const vendorScript = "scripts/vendor-argent-contracts.ts";
const revision = vendorRevisionPin(
  await readFile(vendorScript, "utf8"),
  vendorScript,
  "ARGENT_CONTRACTS_REVISION",
);
const accountDir = `${checkout}/deployments/artifacts/account-${ARGENT_ACCOUNT_CONTRACT.version}-${ARGENT_ACCOUNT_CONTRACT.classHash}`;
const multisigDir = `${checkout}/deployments/artifacts/multisig-${ARGENT_MULTISIG_CONTRACT.version}-${ARGENT_MULTISIG_CONTRACT.classHash}`;

const artifacts = [
  {
    digest: "fefb4b83dd18156a6e747c0e47d9ca19970a0b6d4b72c9123aaab0c63f6b8c81",
    path: `${accountDir}/ArgentAccount-abi.json`,
  },
  {
    digest: "1929e4bc5517ec06c893e941b83a625b93d131b55c0c1fa7eab3038f2f95807d",
    path: `${accountDir}/ArgentAccount.json`,
  },
  {
    digest: "04afbf7a767cd9a486007aaf171a9694a96f0c3eaed7cf880e615ff53c837660",
    path: `${accountDir}/ArgentAccount.casm`,
  },
  {
    digest: "0e12d51ecad1856d0326407c4c5c642252f2fdec6530f7a5d8197964425fe3a6",
    path: `${multisigDir}/ArgentMultisigAccount-abi.json`,
  },
  {
    digest: "d6d3664bc1a66d82d6f1e177d7978dbc1c73d04f12802fdcaa728df88a363103",
    path: `${multisigDir}/ArgentMultisigAccount.json`,
  },
  {
    digest: "ca265846bfb6c555b6f50a8727b5c0864366473e2ed8fcb5f4367df8d526ac63",
    path: `${multisigDir}/ArgentMultisigAccount.casm`,
  },
] as const;

const git = (args: string[]): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd: checkout });
  if (result.exitCode !== 0) {
    throw new Error(`Argent provenance unavailable: git ${args.join(" ")} failed`);
  }
  return result.stdout.toString().trim();
};

const failures = [
  ...vendorProvenanceFailures({
    artifacts: [],
    head: git(["rev-parse", "HEAD"]),
    name: "Argent contracts",
    pinnedRevision: revision,
    worktreeStatus: git(["status", "--porcelain"]),
  }),
];
if (
  ARGENT_ACCOUNT_CONTRACT.upstreamCommit !== revision ||
  ARGENT_MULTISIG_CONTRACT.upstreamCommit !== revision
) {
  failures.push("Argent runtime descriptors do not match the vendored release pin");
}

for (const artifact of artifacts) {
  const file = Bun.file(artifact.path);
  if (!(await file.exists())) {
    failures.push(`missing official Argent artifact: ${artifact.path}`);
    continue;
  }
  const digest = createHash("sha256")
    .update(await readFile(artifact.path))
    .digest("hex");
  if (digest !== artifact.digest) {
    failures.push(`Argent artifact digest mismatch: ${artifact.path}`);
  }
}

const verifyClass = async (
  sierraPath: string,
  casmPath: string,
  expectedClassHash: string,
  expectedCompiledClassHash: string,
): Promise<void> => {
  if (!(await Bun.file(sierraPath).exists()) || !(await Bun.file(casmPath).exists())) return;
  const classHash = hash.computeContractClassHash(await Bun.file(sierraPath).json());
  const compiledClassHash = hash.computeCompiledClassHash(await Bun.file(casmPath).json());
  if (BigInt(classHash) !== BigInt(expectedClassHash)) {
    failures.push(`Argent class hash mismatch: ${sierraPath}`);
  }
  if (BigInt(compiledClassHash) !== BigInt(expectedCompiledClassHash)) {
    failures.push(`Argent compiled class hash mismatch: ${casmPath}`);
  }
};

await verifyClass(
  `${accountDir}/ArgentAccount.json`,
  `${accountDir}/ArgentAccount.casm`,
  ARGENT_ACCOUNT_CONTRACT.classHash,
  ARGENT_ACCOUNT_CONTRACT.compiledClassHash,
);
await verifyClass(
  `${multisigDir}/ArgentMultisigAccount.json`,
  `${multisigDir}/ArgentMultisigAccount.casm`,
  ARGENT_MULTISIG_CONTRACT.classHash,
  ARGENT_MULTISIG_CONTRACT.compiledClassHash,
);

if (failures.length > 0) {
  throw new Error(failures.join("; "));
}
