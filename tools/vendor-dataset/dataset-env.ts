/**
 * Where the vendor-dataset scripts find their seeds. The seed file is
 * git-ignored (`.env*.local`) and lives at the repository root, resolved from
 * this module so the scripts run from any checkout; set
 * `BRAMBLE_DATASET_ENV_FILE` to read it from elsewhere (for example the main
 * checkout while running from a worktree). Nothing here logs or returns more
 * than the one value a caller names.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Absolute path of the seed file the scripts read at run time.
const ENV_PATH =
  process.env["BRAMBLE_DATASET_ENV_FILE"] ??
  resolve(import.meta.dir, "../../.env.vendor-seeds.local");

/** The seed file's lines. Throws if the file is missing. */
export const envLines = (): string[] => readFileSync(ENV_PATH, "utf8").split("\n");

/** One variable's value from the seed file; throws if it is absent or empty. */
export function envSeed(name: string): string {
  for (const line of envLines()) {
    const value = line.match(new RegExp(`^${name}="?([^"]+)"?\\s*$`))?.[1]?.trim();
    if (value) return value;
  }
  throw new Error(`${name} is empty`);
}
