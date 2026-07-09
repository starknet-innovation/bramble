/**
 * Verifies the vendored multisig contract class against the class hashes
 * pinned in src/starknet/multisig-deploy.ts, so the extension can never
 * bundle (or declare) an artifact that drifted from the audited source.
 */
import { hash } from "starknet";
import { MULTISIG_CLASS_HASH, MULTISIG_COMPILED_CLASS_HASH } from "../src/starknet/multisig-deploy";

const sierraPath = "vendor/multisig/multisig.contract_class.json";
const casmPath = "vendor/multisig/multisig.compiled_contract_class.json";

const failures: string[] = [];

const sierraFile = Bun.file(sierraPath);
const casmFile = Bun.file(casmPath);

if (!(await sierraFile.exists()) || !(await casmFile.exists())) {
  console.error(`missing vendored multisig artifacts; run: bun run vendor:multisig`);
  process.exit(1);
}

const sierra = await sierraFile.json();
const casm = await casmFile.json();

const classHash = hash.computeContractClassHash(sierra);
if (BigInt(classHash) !== BigInt(MULTISIG_CLASS_HASH)) {
  failures.push(
    `class hash mismatch: artifact ${classHash} vs pinned ${MULTISIG_CLASS_HASH}; rebuild with bun run vendor:multisig and update src/starknet/multisig-deploy.ts deliberately`,
  );
}

const compiledClassHash = hash.computeCompiledClassHash(casm);
if (BigInt(compiledClassHash) !== BigInt(MULTISIG_COMPILED_CLASS_HASH)) {
  failures.push(
    `compiled class hash mismatch: artifact ${compiledClassHash} vs pinned ${MULTISIG_COMPILED_CLASS_HASH}`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}
