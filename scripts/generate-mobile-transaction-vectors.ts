/**
 * Writes the transaction fixture the mobile core's send plan is tested against
 * (`mobile/core/tests/fixtures/extension-transactions-*.json`): the extension's real send path
 * recorded on the wire, plus its fee policy, amount grammar, presentation rules, status
 * judgement, copy, and timing, and the Swift/Kotlin Send copy tables rendered from that copy.
 * Invoked by `bun run mobile:parity`; `bun run check` fails when a committed file drifts from
 * what the extension produces today.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { renderSendCopy, SEND_COPY_KOTLIN_PATH, SEND_COPY_SWIFT_PATH } from "./mobile-send-copy";
import { computeTransactionFixture, splitTransactionFixture } from "./mobile-transactions-fixture";

const fixture = (await computeTransactionFixture()) as { readonly copy: Record<string, unknown> };
const parts = splitTransactionFixture(fixture);
for (const [path, part] of parts) {
  await writeFile(path, `${JSON.stringify(part, null, 2)}\n`);
}
const copy = renderSendCopy(fixture.copy);
for (const [path, text] of [
  [SEND_COPY_SWIFT_PATH, copy.swift],
  [SEND_COPY_KOTLIN_PATH, copy.kotlin],
] as const) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
// Biome owns JSON style in this repository; the drift test compares the fixture as parsed data.
const formatted = Bun.spawnSync(["bunx", "biome", "format", "--write", ...parts.keys()]);
if (formatted.exitCode !== 0) throw new Error("biome could not format the transaction fixture");
console.log(`wrote ${[...parts.keys(), SEND_COPY_SWIFT_PATH, SEND_COPY_KOTLIN_PATH].join(", ")}`);
