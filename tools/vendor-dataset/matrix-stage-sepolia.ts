/**
 * Sepolia stage (issue 821): builds the scripted test accounts of the
 * import-paths scope doc from the seeds and keys in the seed file, funded by TA-01.
 * Idempotent: every fixture checks chain state first, so re-running resumes.
 * Run from the repository root after TA-01 is deployed:
 *   BRAMBLE_DATASET_NETWORK=sepolia bun tools/vendor-dataset/matrix-stage-sepolia.ts [TA-xx]
 * The optional argument runs only fixtures whose id contains it. Then run
 * `bun run format` so Biome's layout of manifest/sepolia/ is kept.
 */
import { runSepoliaFixtures } from "./sepolia-fixtures";
import { BRM_FIXTURES } from "./sepolia-stage-brm";
import { BRV_FIXTURES } from "./sepolia-stage-brv";
import { SCR_FIXTURES } from "./sepolia-stage-scr";

await runSepoliaFixtures([...BRM_FIXTURES, ...SCR_FIXTURES, ...BRV_FIXTURES], process.argv[2]);
console.log("\nSepolia stage done; manifest written");
