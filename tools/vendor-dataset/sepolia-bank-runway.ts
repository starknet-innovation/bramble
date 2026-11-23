/**
 * Before the nightly sends anything on Sepolia (issue 976): the node must be
 * Sepolia, and the S-TXN bank and senders must hold enough testnet STRK for
 * tonight's send and deploy runs. A short balance exits non-zero with
 * "Sepolia bank low", an infrastructure failure to refill by re-running
 * `matrix-stage-sepolia.ts TX`, never a wallet failure. Reads balances only;
 * needs no seed, since every address is in manifest/sepolia/s-txn.json.
 *
 *   BRAMBLE_DATASET_NETWORK=sepolia bun tools/vendor-dataset/sepolia-bank-runway.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHAIN_ID, NETWORK, provider, tokenBalance } from "./matrix-lib";

if (NETWORK !== "sepolia") throw new Error("set BRAMBLE_DATASET_NETWORK=sepolia");

const STRK = 10n ** 18n;
// Measured 2026-11-20: the deploy run sends 1 STRK to each of five accounts at
// once and takes about 2 STRK a night; a send costs about 0.05 STRK.
const BANK_FLOOR = 6n * STRK;
const BANK_PER_NIGHT = 2n * STRK;
const SENDER_FLOOR = STRK / 5n;
const WARN_NIGHTS = 7n;

const chain = await provider.getChainId();
if (chain !== CHAIN_ID) throw new Error(`the node is on ${chain}, not SN_SEPOLIA`);

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dir, "manifest/sepolia/s-txn.json"), "utf8"),
) as Record<string, { readonly address: string }>;
const strk = (raw: bigint): string => (Number(raw / 10n ** 15n) / 1000).toFixed(3);

const low: string[] = [];
for (const [id, { address }] of Object.entries(manifest)) {
  const balance = await tokenBalance("STRK", address);
  const bank = id === "s-txn/TX-00";
  if (balance < (bank ? BANK_FLOOR : SENDER_FLOOR)) low.push(`${id} holds ${strk(balance)} STRK`);
  if (bank) {
    const nights = balance / BANK_PER_NIGHT;
    console.log(`bank ${strk(balance)} STRK, about ${nights} nights of deploy runs`);
    if (nights < WARN_NIGHTS) console.log("::warning::Sepolia bank runs out within a week");
  }
}
if (low.length > 0) {
  console.log(
    `::error::Sepolia bank low: ${low.join("; ")}. Refill with matrix-stage-sepolia.ts TX.`,
  );
  process.exit(1);
}
console.log("Sepolia bank and senders funded");
