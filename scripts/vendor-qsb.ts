/**
 * Fetches the pinned QSB pipeline sources the background's Pyodide runtime runs.
 *
 * Trust boundary: everything under `vendor/qsb` is untrusted upstream code that
 * this repository binds by commit. The checkout is a sparse, blob-filtered clone
 * of the qsb-app repository holding only its `public/qsb/` directory: the four
 * Python sources, the SHA-256 manifest qsb-app's own runtime checks them
 * against, and the pipeline's licence. Nothing is built or executed here; the
 * files ship byte for byte, and `check:qsb` verifies the commit, a clean
 * worktree, and a reviewed digest for each of them before `build` copies any.
 *
 * Fails closed: any git step that exits non-zero throws, and a checkout that
 * does not end on the pinned commit is refused by `check:qsb` rather than here,
 * so the verifier and this script read one pin (`vendorRevisionPin`).
 */
import { mkdir } from "node:fs/promises";

const repo = "https://github.com/starknet-innovation/qsb-app.git";
const target = "vendor/qsb";
const QSB_APP_REVISION = "8685328ca4e1ccae5f1f1f2fb84244893d9d2346";
// The only upstream directory the wallet ships. A non-cone sparse pattern keeps
// every other path of qsb-app — its server, solver, webapp and even its
// top-level files, which cone mode would always materialize — out of this
// workspace entirely; the blob filter means they are never even downloaded.
const SHIPPED_DIRECTORY = "/public/qsb/";

const run = async (command: string[], cwd = "."): Promise<void> => {
  const child = Bun.spawn(command, { cwd, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`);
  }
};

await mkdir("vendor", { recursive: true });
if (!(await Bun.file(`${target}/.git/HEAD`).exists())) {
  await run(["git", "clone", "--filter=blob:none", "--no-checkout", repo, target]);
}
await run(["git", "sparse-checkout", "set", "--no-cone", SHIPPED_DIRECTORY], target);
await run(["git", "fetch", "--depth=1", "origin", QSB_APP_REVISION], target);
await run(["git", "checkout", "--detach", QSB_APP_REVISION], target);
