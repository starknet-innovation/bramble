/**
 * Builds the in-repo multisig preset contract (contracts/multisig) with scarb
 * and vendors the Sierra + CASM artifacts into vendor/multisig. The build is
 * reproducible: OpenZeppelin dependencies are pinned exactly in Scarb.toml,
 * and check-multisig-class.ts verifies the artifacts still match the class
 * hashes pinned in src/starknet/multisig-deploy.ts.
 */
import { cp, mkdir } from "node:fs/promises";

const SCARB_VERSION = "2.18.0";
const target = "vendor/multisig";
const built = `${target}/target/dev`;

const run = async (cmd: string[], env: Record<string, string> = {}): Promise<void> => {
  const child = Bun.spawn(cmd, {
    cwd: "contracts/multisig",
    env: { ...process.env, ...env },
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed with exit code ${exitCode}`);
  }
};

const version = Bun.spawnSync(["scarb", "--version"]).stdout.toString();
if (!version.startsWith(`scarb ${SCARB_VERSION}`)) {
  throw new Error(
    `scarb ${SCARB_VERSION} required for a reproducible class hash; found: ${version.split("\n")[0] ?? "none"}`,
  );
}

await mkdir(target, { recursive: true });
await run(["scarb", "build"], { SCARB_TARGET_DIR: `${process.cwd()}/${target}/target` });
await cp(
  `${built}/mc_multisig_MultisigWallet.contract_class.json`,
  `${target}/multisig.contract_class.json`,
);
await cp(
  `${built}/mc_multisig_MultisigWallet.compiled_contract_class.json`,
  `${target}/multisig.compiled_contract_class.json`,
);
