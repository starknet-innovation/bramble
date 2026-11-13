/**
 * Writes the Nostr coordination parity fixture parts for `bun run mobile:parity`. Every vector is
 * deterministic (fixed inputs, fixed clocks, stand-in events), so each run recomputes the whole
 * fixture and a rerun leaves no diff.
 */
import { writeFile } from "node:fs/promises";
import {
  computeNostrCoordinationParity,
  NOSTR_COORDINATION_FIXTURE_PATHS,
} from "../mobile-nostr-coordination-parity";

/** Recomputes the vectors and writes each part; returns their paths. */
export const writeNostrCoordinationParity = async (): Promise<readonly string[]> => {
  const parts = await computeNostrCoordinationParity();
  const paths = Object.values(NOSTR_COORDINATION_FIXTURE_PATHS);
  for (const [part, path] of Object.entries(NOSTR_COORDINATION_FIXTURE_PATHS)) {
    await writeFile(path, `${JSON.stringify(parts[part as keyof typeof parts])}\n`);
  }
  // Biome owns JSON style, as for the Nostr multisig fixture, so a rerun never restyles the file.
  const formatted = Bun.spawnSync(["bunx", "biome", "format", "--write", ...paths]);
  if (formatted.exitCode !== 0) {
    throw new Error("biome could not format the Nostr coordination fixture");
  }
  return paths;
};
