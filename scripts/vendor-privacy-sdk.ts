/**
 * Vendors the pinned official Starknet privacy SDK browser bundle.
 */
import { mkdir } from "node:fs/promises";

const repo = "https://github.com/starkware-libs/starknet-privacy.git";
const target = "vendor/starknet-privacy";
const PRIVACY_SDK_REVISION = "722d1cfbddfc0e7d65f45084cfced08f092d2f3c";

const run = async (command: string[], cwd = "."): Promise<void> => {
  const child = Bun.spawn(command, { cwd, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }
};

await mkdir("vendor", { recursive: true });
if (!(await Bun.file(`${target}/sdk/package.json`).exists())) {
  await run(["git", "clone", "--filter=blob:none", "--no-checkout", repo, target]);
}
await run(["git", "fetch", "--depth=1", "origin", PRIVACY_SDK_REVISION], target);
await run(["git", "checkout", "--detach", PRIVACY_SDK_REVISION], target);
await run(["npm", "ci", "--ignore-scripts"], `${target}/sdk`);
await run(["npm", "run", "build:browser"], `${target}/sdk`);
