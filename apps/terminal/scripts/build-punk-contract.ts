/**
 * Rebuilds the terminal's OpenZeppelin ERC721 class and copies the Sierra
 * artifact into Vite's public directory. Run from apps/terminal.
 */
import { cp, mkdir, readFile } from "node:fs/promises";
import { hash } from "starknet";
import {
  PUNK_CLASS_HASH,
  PUNK_COMPILED_CLASS_HASH,
} from "../src/nft/punk-contract";

const manifest = "contracts/punk_collection/Scarb.toml";
const artifact =
  "contracts/punk_collection/target/dev/mc_punk_PunkCollection.contract_class.json";
const compiledArtifact =
  "contracts/punk_collection/target/dev/mc_punk_PunkCollection.compiled_contract_class.json";
const publicDirectory = "public/contracts";

const child = Bun.spawn(["scarb", "--manifest-path", manifest, "build"], {
  stderr: "inherit",
  stdout: "inherit",
});
const exitCode = await child.exited;
if (exitCode !== 0) {
  throw new Error(`scarb build failed with exit code ${exitCode}`);
}

const sierra = JSON.parse(await readFile(artifact, "utf8"));
const casm = JSON.parse(await readFile(compiledArtifact, "utf8"));
const classHash = hash.computeContractClassHash(
  sierra as Parameters<typeof hash.computeContractClassHash>[0],
);
const compiledClassHash = hash.computeCompiledClassHash(
  casm as Parameters<typeof hash.computeCompiledClassHash>[0],
);
if (BigInt(classHash) !== BigInt(PUNK_CLASS_HASH)) {
  throw new Error(`Punk Sierra class hash drifted: expected ${PUNK_CLASS_HASH}, got ${classHash}`);
}
if (BigInt(compiledClassHash) !== BigInt(PUNK_COMPILED_CLASS_HASH)) {
  throw new Error(
    `Punk compiled class hash drifted: expected ${PUNK_COMPILED_CLASS_HASH}, got ${compiledClassHash}`,
  );
}

await mkdir(publicDirectory, { recursive: true });
await cp(artifact, `${publicDirectory}/punk_collection.contract_class.json`);
console.log(`Published pinned Punk class ${PUNK_CLASS_HASH}`);
