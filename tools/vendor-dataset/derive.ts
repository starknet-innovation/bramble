/**
 * Phase-2 calibration: reproduce the addresses the real Ready and Braavos apps
 * showed for the ground-truth seeds, from an independent reimplementation of
 * each vendor's derivation (argent-x source e3545daa, Braavos forum post).
 * Reads seeds from .env.vendor-seeds.local and prints ONLY addresses/verdicts —
 * never key material.
 */
import { readFileSync } from "node:fs";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { grindKey, getStarkKey } from "@scure/starknet";
import { hash } from "starknet";

const ENV_PATH = "/Users/henri/Workshop/mc-wallet/.env.vendor-seeds.local";

const BRAAVOS_BASE = "0x13bfe114fb1cf405bfc3a7f8dbe2d91db146c17521d40dcf57e16d6b59fa8e6";
const BRAAVOS_100 = "0x03d16c7a9a60b0593bd202f660a28c5d76e0403601d9ccc7e4fa253b6a70c201";
const ARGENT_040 = "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";
const ARGENT_031 = "0x029927c8af6bccf3f6fda035981e765a7bdbf18a2dc0d630494f8758aa908e2b";

function readEnv(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?\s*$/);
    if (m && m[2].trim()) out.set(m[1], m[2].trim());
  }
  return out;
}

function recordedAddresses(): { ready: string[]; braavos: string[] } {
  const ready: string[] = [];
  const braavos: string[] = [];
  let section = "";
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    if (line.includes("READY_MAIN")) section = "ready";
    else if (line.includes("BRAAVOS_MAIN")) section = "braavos";
    else if (line.includes("SEED_CROSS")) section = "";
    const m = line.match(/account \d+ address:\s*(0x[0-9a-fA-F]+)/);
    if (m && section === "ready") ready.push(m[1]);
    if (m && section === "braavos") braavos.push(m[1]);
  }
  return { ready, braavos };
}

const norm = (a: string) => "0x" + BigInt(a).toString(16);

// Braavos: master node straight from the BIP-39 seed, address axis, grindKey.
function braavosKey(mnemonic: string, index: number): string {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(
    `m/44'/9004'/0'/0/${index}`,
  );
  if (!node.privateKey) throw new Error("no key");
  return getStarkKey("0x" + grindKey(node.privateKey));
}

// Ready: ETH key at m/44'/60'/0'/0/0 becomes the master seed, then the same
// address-axis stark tree (argent-x ArgentSigner + WalletCryptoSharedService).
function readyKey(mnemonic: string, index: number): string {
  const ethNode = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/44'/60'/0'/0/0");
  if (!ethNode.privateKey) throw new Error("no eth key");
  const node = HDKey.fromMasterSeed(ethNode.privateKey).derive(`m/44'/9004'/0'/0/${index}`);
  if (!node.privateKey) throw new Error("no key");
  return getStarkKey("0x" + grindKey(node.privateKey));
}

// Bramble's own ladder (Krusty semantics): BIP-39 seed directly, account axis.
function brambleKey(mnemonic: string, accountIndex: number): string {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(
    `m/44'/9004'/${accountIndex}'/0/0`,
  );
  if (!node.privateKey) throw new Error("no key");
  return getStarkKey("0x" + grindKey(node.privateKey));
}

const braavosAddress = (pub: string, cls: string) =>
  hash.calculateContractAddressFromHash(pub, cls, [pub], 0);
const argentAddress = (pub: string, cls: string) =>
  cls === ARGENT_040
    ? hash.calculateContractAddressFromHash(pub, cls, ["0x0", pub, "0x1"], 0)
    : hash.calculateContractAddressFromHash(pub, cls, [pub, "0x0"], 0);

const env = readEnv();
const rec = recordedAddresses();
const verdict = (derived: string, candidates: string[]) => {
  const i = candidates.findIndex((c) => norm(c) === norm(derived));
  return i >= 0 ? `MATCH recorded account ${i + 1}` : "no recorded match";
};

const braavosSeed = env.get("BRAMBLE_DATASET_SEED_BRAAVOS_MAIN");
if (braavosSeed) {
  console.log("── Braavos (vendor derivation, address axis) ──");
  for (let i = 0; i < 5; i++) {
    const pub = braavosKey(braavosSeed, i);
    const base = braavosAddress(pub, BRAAVOS_BASE);
    const v100 = braavosAddress(pub, BRAAVOS_100);
    console.log(
      `index ${i}: base-class ${norm(base)} [${verdict(base, rec.braavos)}]` +
        (verdict(v100, rec.braavos).startsWith("MATCH") ? ` | 1.0.0 ${norm(v100)} [${verdict(v100, rec.braavos)}]` : ""),
    );
  }
  console.log("── Braavos seed through Bramble's ladder (account axis) ──");
  for (let i = 0; i < 3; i++) {
    const pub = brambleKey(braavosSeed, i);
    const base = braavosAddress(pub, BRAAVOS_BASE);
    console.log(`account ${i}: ${norm(base)} [${verdict(base, rec.braavos)}]`);
  }
}

const readySeed = env.get("BRAMBLE_DATASET_SEED_READY_MAIN");
if (readySeed) {
  console.log("── Ready (vendor double derivation, address axis) ──");
  for (let i = 0; i < 6; i++) {
    const pub = readyKey(readySeed, i);
    const a40 = argentAddress(pub, ARGENT_040);
    const a31 = argentAddress(pub, ARGENT_031);
    const extra = verdict(a31, rec.ready).startsWith("MATCH")
      ? ` | 0.3.1 ${norm(a31)} [${verdict(a31, rec.ready)}]`
      : "";
    console.log(`index ${i}: 0.4.0 ${norm(a40)} [${verdict(a40, rec.ready)}]${extra}`);
  }
  console.log("── Ready seed through Bramble's ladder (account axis, direct BIP-39) ──");
  for (let i = 0; i < 3; i++) {
    const pub = brambleKey(readySeed, i);
    const a40 = argentAddress(pub, ARGENT_040);
    console.log(`account ${i}: ${norm(a40)} [${verdict(a40, rec.ready)}]`);
  }
}

console.log(`\nrecorded: ready=${rec.ready.length} braavos=${rec.braavos.length}`);
