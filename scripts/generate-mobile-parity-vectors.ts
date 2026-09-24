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
  PARITY_FIXTURE_PATH,
  PARITY_MESSAGE_HASH,
  PARITY_MNEMONIC,
} from "./mobile-parity";

const envelopePassword = "parity-vector-password";
const envelopeScope = "bramble.parity";
const envelopePlaintext = { hello: "bramble", n: 7 };

const fixture = {
  accounts: await computeParityAccounts(),
  envelope: {
    password: envelopePassword,
    plaintext: envelopePlaintext,
    scope: envelopeScope,
    sealed: await encryptJson(envelopePlaintext, envelopePassword, envelopeScope),
  },
  messageHash: PARITY_MESSAGE_HASH,
  mnemonic: PARITY_MNEMONIC,
};

await writeFile(PARITY_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${PARITY_FIXTURE_PATH}`);
