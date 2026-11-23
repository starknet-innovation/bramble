/**
 * Writes the extension-parity fixture the mobile Rust core is tested against: derivation vectors
 * from the extension's real Krusty path, plus one vault envelope sealed by the extension's own
 * `encryptJson`, so the core proves it can open what the extension writes. Re-run after bumping
 * Krusty in `package.json` or moving mobile's wallet-core pin (`mobile/core/Cargo.toml`): `bun run mobile:parity`.
 *
 * Sealing draws a fresh salt, IV and commit, so re-sealing on every run would rewrite the fixture
 * with no change in meaning. A committed envelope is therefore kept when it is still one the
 * extension writes today (`sealedIsCurrent`: current version and KDF, and `decryptJson` opens it
 * to the expected plaintext), and re-sealed only when it is not. Re-running leaves no diff.
 */
import { readFile, writeFile } from "node:fs/promises";
import { encryptJson } from "@bramble/vault/encrypted-store";
import { writeNostrCoordinationParity } from "./mobile-assets/write-nostr-coordination-parity";
import { writeNostrMultisigParity } from "./mobile-assets/write-nostr-multisig-parity";
import { computeMultisigTransactionFixture } from "./mobile-multisig-refusals";
import {
  computeParityAccounts,
  computeUiParity,
  PARITY_FIXTURE_PATH,
  PARITY_MESSAGE_HASH,
  PARITY_MNEMONIC,
  sealedIsCurrent,
} from "./mobile-parity";
import { ACCOUNTS_PARITY_FIXTURE_PATHS, computeAccountParity } from "./mobile-parity-accounts";
import { ACTIVITY_PARITY_FIXTURE_PATH, renderActivityParity } from "./mobile-parity-activity";
import {
  ACTIVITY_FEED_FIXTURE_PATH,
  renderActivityFeedParity,
} from "./mobile-parity-activity-feed";
import { PORTFOLIO_PARITY_FIXTURE_PATH, renderPortfolioParity } from "./mobile-parity-portfolio";
import { ACCOUNTS_SCAN_FIXTURE_PATHS, computeScanParity } from "./mobile-parity-scan";
import { renderSettingsParity, SETTINGS_PARITY_FIXTURE_PATH } from "./mobile-parity-settings";
import { renderStarkNameParity, STARK_NAME_PARITY_FIXTURE_PATH } from "./mobile-parity-stark-name";
import {
  computeImportedVaultParity,
  computeVaultParity,
  VAULT_IMPORTED_FIXTURE_PATH,
  VAULT_PARITY_FIXTURE_PATH,
} from "./mobile-parity-vault";

const envelopePassword = "parity-vector-password";
const envelopeScope = "bramble.parity";
const envelopePlaintext = { hello: "bramble", n: 7 };
// The mobile vault's passphrase slot is this envelope around `{ dek }` (mobile/docs/vault-security.md
// §3.1); sealing one here proves the Rust core opens the extension's own bytes for it.
const dekSlotPassword = "parity-dek-slot-password";
const dekSlotScope = "bramble.mobile.dek.v1";
const dekSlotPlaintext = { dek: Buffer.alloc(32, 0x5a).toString("base64") };

type Sealed = Awaited<ReturnType<typeof encryptJson>>;

const committed = await readFile(PARITY_FIXTURE_PATH, "utf8")
  .then((text) => JSON.parse(text) as Record<string, { readonly sealed?: unknown } | undefined>)
  .catch(() => ({}) as Record<string, { readonly sealed?: unknown } | undefined>);

/** The committed envelope under `key` when the extension still opens it as-is, else a new seal. */
const keepOrSeal = async (
  key: "dekSlot" | "envelope",
  plaintext: { readonly [name: string]: string | number },
  password: string,
  scope: string,
): Promise<Sealed> => {
  const existing = committed[key]?.sealed;
  if (await sealedIsCurrent(existing, plaintext, password, scope)) return existing as Sealed;
  return encryptJson(plaintext, password, scope);
};

const fixture = {
  accounts: await computeParityAccounts(),
  dekSlot: {
    password: dekSlotPassword,
    plaintext: dekSlotPlaintext,
    scope: dekSlotScope,
    sealed: await keepOrSeal("dekSlot", dekSlotPlaintext, dekSlotPassword, dekSlotScope),
  },
  envelope: {
    password: envelopePassword,
    plaintext: envelopePlaintext,
    scope: envelopeScope,
    sealed: await keepOrSeal("envelope", envelopePlaintext, envelopePassword, envelopeScope),
  },
  messageHash: PARITY_MESSAGE_HASH,
  mnemonic: PARITY_MNEMONIC,
  ui: computeUiParity(),
};

await writeFile(PARITY_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${PARITY_FIXTURE_PATH}`);

const accounts = await computeAccountParity();
for (const part of ["familiesMainnet", "familiesSepolia", "recovery", "rules"] as const) {
  const path = ACCOUNTS_PARITY_FIXTURE_PATHS[part];
  await writeFile(path, `${JSON.stringify(accounts[part], null, 2)}\n`);
  console.log(`wrote ${path}`);
}
const scan = await computeScanParity();
for (const part of ["scan", "signing"] as const) {
  const path = ACCOUNTS_SCAN_FIXTURE_PATHS[part];
  await writeFile(path, `${JSON.stringify(scan[part], null, 2)}\n`);
  console.log(`wrote ${path}`);
}
// Biome owns JSON style in this repository; the drift test compares the fixtures as parsed data.
const scanPaths = Object.values(ACCOUNTS_SCAN_FIXTURE_PATHS);
if (Bun.spawnSync(["bunx", "biome", "format", "--write", ...scanPaths]).exitCode !== 0) {
  throw new Error("biome could not format the recovery-scan fixtures");
}

/** The committed vault seal, or `undefined` only when the fixture file is missing. */
const readCommittedVaultSeal = async (path: string): Promise<unknown> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  return (JSON.parse(text) as { readonly sealed?: unknown }).sealed;
};

// The v13 vault keeps its committed seal when the extension still opens it to the same payload.
// So does the imported-key vault (P3).
for (const [path, compute] of [
  [VAULT_PARITY_FIXTURE_PATH, computeVaultParity],
  [VAULT_IMPORTED_FIXTURE_PATH, computeImportedVaultParity],
] as const) {
  const vault = await compute(await readCommittedVaultSeal(path));
  await writeFile(path, `${JSON.stringify(vault, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

await writeFile(ACTIVITY_PARITY_FIXTURE_PATH, await renderActivityParity());
console.log(`wrote ${ACTIVITY_PARITY_FIXTURE_PATH}`);

// The RPC override rules (P4) and Starknet name lookups (P5), recomputed in full.
await writeFile(SETTINGS_PARITY_FIXTURE_PATH, await renderSettingsParity());
console.log(`wrote ${SETTINGS_PARITY_FIXTURE_PATH}`);
await writeFile(STARK_NAME_PARITY_FIXTURE_PATH, await renderStarkNameParity());
console.log(`wrote ${STARK_NAME_PARITY_FIXTURE_PATH}`);
await writeFile(ACTIVITY_FEED_FIXTURE_PATH, renderActivityFeedParity());
console.log(`wrote ${ACTIVITY_FEED_FIXTURE_PATH}`);

// The transaction fixture and Send copy tables are part of the same `bun run mobile:parity` run.
await import("./generate-mobile-transaction-vectors");

// So is the multisig transaction fixture (G5), deterministic and recomputed in full.
const multisig = await computeMultisigTransactionFixture();
for (const [path, part] of multisig) {
  await writeFile(path, `${JSON.stringify(part, null, 2)}\n`);
  console.log(`wrote ${path}`);
}
if (Bun.spawnSync(["bunx", "biome", "format", "--write", ...multisig.keys()]).exitCode !== 0) {
  throw new Error("biome could not format the multisig transaction fixtures");
}

console.log(`wrote ${await writeNostrMultisigParity()}`);
for (const path of await writeNostrCoordinationParity()) console.log(`wrote ${path}`);

await writeFile(PORTFOLIO_PARITY_FIXTURE_PATH, await renderPortfolioParity());
console.log(`wrote ${PORTFOLIO_PARITY_FIXTURE_PATH}`);

// So are the privacy fixture and the privacy copy tables.
await import("./generate-mobile-privacy-vectors");
