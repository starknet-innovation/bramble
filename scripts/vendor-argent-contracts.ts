/**
 * Fetches the exact production Argent account-contract release used by the
 * wallet. The checkout is verification-only: no Argent source or artifact is
 * copied into the extension bundle because both supported classes are already
 * declared on Mainnet and Sepolia.
 */
import { mkdir } from "node:fs/promises";

const repo = "https://github.com/argentlabs/argent-contracts-starknet.git";
const target = "vendor/argent-contracts";
const ARGENT_CONTRACTS_REVISION = "1352198956f36fb35fa544c4e46a3507a3ec20e3";

const run = async (command: string[], cwd = "."): Promise<void> => {
  const child = Bun.spawn(command, { cwd, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }
};

await mkdir("vendor", { recursive: true });
if (!(await Bun.file(`${target}/Scarb.toml`).exists())) {
  await run(["git", "clone", "--filter=blob:none", "--no-checkout", repo, target]);
}
await run(["git", "fetch", "--depth=1", "origin", ARGENT_CONTRACTS_REVISION], target);
await run(["git", "checkout", "--detach", ARGENT_CONTRACTS_REVISION], target);
