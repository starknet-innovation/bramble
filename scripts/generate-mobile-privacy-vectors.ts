/**
 * Writes the privacy fixture the mobile core and apps are tested against
 * (`mobile/core/tests/fixtures/extension-privacy-*.json`): viewing keys from the extension's Krusty
 * path, discovery and pool reads recorded from its official-SDK adapter, its privacy gates and
 * copy, and the Swift/Kotlin copy tables rendered from that copy. Invoked by
 * `bun run mobile:parity`; `bun run check` fails when a committed file drifts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  PRIVACY_COPY_KOTLIN_PATH,
  PRIVACY_COPY_SWIFT_PATH,
  renderPrivacyCopy,
} from "./mobile-privacy-copy";
import { computePrivacyFixture, PRIVACY_FIXTURE_PATHS } from "./mobile-privacy-fixture";

const parts = await computePrivacyFixture();
for (const [path, part] of parts) {
  await writeFile(path, `${JSON.stringify(part, null, 2)}\n`);
}
const copyDocument = parts.get(PRIVACY_FIXTURE_PATHS.copy) as {
  readonly copy: Parameters<typeof renderPrivacyCopy>[0];
};
const copy = renderPrivacyCopy(copyDocument.copy);
for (const [path, text] of [
  [PRIVACY_COPY_SWIFT_PATH, copy.swift],
  [PRIVACY_COPY_KOTLIN_PATH, copy.kotlin],
] as const) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
// Biome owns JSON style in this repository; the drift test compares the fixture as parsed data.
const formatted = Bun.spawnSync(["bunx", "biome", "format", "--write", ...parts.keys()]);
if (formatted.exitCode !== 0) throw new Error("biome could not format the privacy fixture");
console.log(
  `wrote ${[...parts.keys(), PRIVACY_COPY_SWIFT_PATH, PRIVACY_COPY_KOTLIN_PATH].join(", ")}`,
);
