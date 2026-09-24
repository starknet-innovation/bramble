/**
 * Writes the extension-parity fixture the mobile Rust core is tested against: derivation vectors
 * from the extension's real Krusty path, plus one vault envelope sealed by the extension's own
 * `encryptJson`, so the core proves it can open what the extension writes. Re-run after bumping
 * Krusty in both `package.json` and `mobile/core/Cargo.toml`: `bun run mobile:parity`.
 */
import { writeFile } from "node:fs/promises";
import { encryptJson } from "@bramble/vault/encrypted-store";
import {
  computeParityAccounts,
  computeUiParity,
  PARITY_FIXTURE_PATH,
  PARITY_MESSAGE_HASH,
  PARITY_MNEMONIC,
} from "./mobile-parity";

const envelopePassword = "parity-vector-password";
const envelopeScope = "bramble.parity";
const envelopePlaintext = { hello: "bramble", n: 7 };
// The mobile vault's passphrase slot is this envelope around `{ dek }` (mobile/docs/vault-security.md
// §3.1); sealing one here proves the Rust core opens the extension's own bytes for it.
const dekSlotPassword = "parity-dek-slot-password";
const dekSlotScope = "bramble.mobile.dek.v1";
const dekSlotPlaintext = { dek: Buffer.alloc(32, 0x5a).toString("base64") };

const fixture = {
  accounts: await computeParityAccounts(),
  dekSlot: {
    password: dekSlotPassword,
    plaintext: dekSlotPlaintext,
    scope: dekSlotScope,
    sealed: await encryptJson(dekSlotPlaintext, dekSlotPassword, dekSlotScope),
  },
  envelope: {
    password: envelopePassword,
    plaintext: envelopePlaintext,
    scope: envelopeScope,
    sealed: await encryptJson(envelopePlaintext, envelopePassword, envelopeScope),
  },
  messageHash: PARITY_MESSAGE_HASH,
  mnemonic: PARITY_MNEMONIC,
  ui: computeUiParity(),
};

await writeFile(PARITY_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${PARITY_FIXTURE_PATH}`);
