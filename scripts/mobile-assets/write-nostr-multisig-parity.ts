/**
 * Writes `mobile/core/tests/fixtures/nostr-multisig-parity.json` for `bun run mobile:parity`. The
 * deterministic vectors are recomputed every run. The extension-made gift wrap is randomised, so a
 * committed wrap is kept while it still opens through the extension, and replaced only when it
 * is missing or no longer opens; reruns therefore leave the fixture unchanged.
 */
import { readFile, writeFile } from "node:fs/promises";
import {
  COSIGNER_NOSTR_INDEX,
  computeNostrMultisigParity,
  GIFT_WRAP_CONTENT,
  GIFT_WRAP_IDENTIFIER,
  giftWrapRejections,
  NOSTR_MULTISIG_FIXTURE_PATH,
  openWithExtension,
  wrapWithExtension,
} from "../mobile-nostr-multisig-parity";

const committedWrap = async (): Promise<string | null> => {
  try {
    const fixture = JSON.parse(await readFile(NOSTR_MULTISIG_FIXTURE_PATH, "utf8")) as {
      readonly giftWrap?: { readonly eventJson?: unknown };
    };
    const eventJson = fixture.giftWrap?.eventJson;
    return typeof eventJson === "string" &&
      (await openWithExtension(COSIGNER_NOSTR_INDEX, eventJson))
      ? eventJson
      : null;
  } catch {
    return null;
  }
};

/** Recomputes the vectors and writes the fixture; returns its path. */
export const writeNostrMultisigParity = async (): Promise<string> => {
  const eventJson = (await committedWrap()) ?? (await wrapWithExtension());
  const fixture = {
    ...(await computeNostrMultisigParity()),
    giftWrap: {
      content: GIFT_WRAP_CONTENT,
      eventJson,
      identifier: GIFT_WRAP_IDENTIFIER,
      recipientNostrIndex: COSIGNER_NOSTR_INDEX,
      rejections: giftWrapRejections(eventJson),
    },
  };
  // One line per section keeps the fixture reviewable and inside the repository's line budget.
  const sections = Object.entries(fixture).map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  );
  await writeFile(NOSTR_MULTISIG_FIXTURE_PATH, `{\n${sections.join(",\n")}\n}\n`);
  // Biome owns JSON style here, as for the transaction fixture; without this pass every
  // `bun run mobile:parity` rewrote the committed (formatted) file.
  const formatted = Bun.spawnSync([
    "bunx",
    "biome",
    "format",
    "--write",
    NOSTR_MULTISIG_FIXTURE_PATH,
  ]);
  if (formatted.exitCode !== 0)
    throw new Error("biome could not format the Nostr multisig fixture");
  return NOSTR_MULTISIG_FIXTURE_PATH;
};
