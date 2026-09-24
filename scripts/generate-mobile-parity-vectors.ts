/**
 * Writes the extension-parity fixture the mobile Rust core is tested against: derivation vectors
 * from the extension's real Krusty path, plus one vault envelope sealed by the extension's own
 * `encryptJson`, so the core proves it can open what the extension writes. Re-run after bumping
 * Krusty in both `package.json` and `mobile/core/Cargo.toml`: `bun run mobile:parity`.
 *
 * Sealing draws a fresh salt, IV and commit, so re-sealing on every run would rewrite the fixture
 * with no change in meaning. A committed envelope is therefore kept when it is still one the
 * extension writes today (`sealedIsCurrent`: current version and KDF, and `decryptJson` opens it
 * to the expected plaintext), and re-sealed only when it is not. Re-running leaves no diff.
 */
import { readFile, writeFile } from "node:fs/promises";
import { encryptJson } from "@bramble/vault/encrypted-store";
import { writeNostrMultisigParity } from "./mobile-assets/write-nostr-multisig-parity";
import {
  computeParityAccounts,
  computeUiParity,
  PARITY_FIXTURE_PATH,
  PARITY_MESSAGE_HASH,
  PARITY_MNEMONIC,
  sealedIsCurrent,
} from "./mobile-parity";
import { ACCOUNTS_PARITY_FIXTURE_PATHS, computeAccountParity } from "./mobile-parity-accounts";

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
for (const part of ["families", "rules"] as const) {
  const path = ACCOUNTS_PARITY_FIXTURE_PATHS[part];
  await writeFile(path, `${JSON.stringify(accounts[part], null, 2)}\n`);
  console.log(`wrote ${path}`);
}

// The transaction fixture and Send copy tables are part of the same `bun run mobile:parity` run.
await import("./generate-mobile-transaction-vectors");

console.log(`wrote ${await writeNostrMultisigParity()}`);
