/**
 * Phase-3 stage C: the USDC-only fixture, the 0.3.0→0.4.0 upgrade veteran, and
 * the guardian/escape simulations on Argent 0.4.0 — all with keys we hold
 * (guardian = deployer-seed child 1, replacement owner = child 2), mirroring
 * the real specimen's on-chain shape. Idempotent: every step checks chain
 * state first. Argent 0.4.0 signature formats (from the account-0.4.0 source):
 * single stark owner may sign legacy [r,s]; owner+guardian legacy [or,os,gr,gs];
 * guardian-alone must use the modern signer array [1, 0, pubkey, r, s].
 */

import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { Account, ec, num, Signer } from "starknet";
import {
  argentAddress,
  argentConstructor,
  CLASSES,
  classAt,
  deployerAccount,
  envSeed,
  type FixtureOutcome,
  loadManifest,
  type ManifestEntry,
  provider,
  readyKeypair,
  runFixture,
  saveManifest,
  tokenBalance,
  transfer,
} from "./matrix-lib";

const { grindKey, getStarkKey } = ec.starkCurve;

const STRK_FLOAT = 2n * 10n ** 18n;
const USDC_DUST = 2n * 10n ** 6n; // 2 USDC

type KP = { priv: string; pub: string };
const auxKey = (index: number): KP => {
  const node = HDKey.fromMasterSeed(
    mnemonicToSeedSync(envSeed("BRAMBLE_DATASET_SEED_DEPLOYER")),
  ).derive(`m/44'/9004'/0'/0/${index}`);
  if (!node.privateKey) throw new Error("derivation failed");
  const priv = `0x${grindKey(node.privateKey)}`;
  return { priv, pub: getStarkKey(priv) };
};
const GUARDIAN = auxKey(1);
const NEW_OWNER = auxKey(2);

const sigOf = (msgHash: string, priv: string): [string, string] => {
  const sig = ec.starkCurve.sign(msgHash, priv);
  return [num.toHex(sig.r), num.toHex(sig.s)];
};

const firstKey = (keys: readonly KP[]): KP => {
  const [first] = keys;
  if (!first) throw new Error("a signer needs at least one key");
  return first;
};

/** Legacy multi-sig: [or, os] or [or, os, gr, gs]. */
class LegacySigner extends Signer {
  constructor(private keys: KP[]) {
    super(firstKey(keys).priv);
  }
  override async signRaw(msgHash: string): Promise<string[]> {
    return this.keys.flatMap((k) => sigOf(msgHash, k.priv));
  }
}

/** Modern signer array: [n, (0, pubkey, r, s)×n] — required for guardian-alone. */
class ModernSigner extends Signer {
  constructor(private keys: KP[]) {
    super(firstKey(keys).priv);
  }
  override async signRaw(msgHash: string): Promise<string[]> {
    return [
      num.toHex(this.keys.length),
      ...this.keys.flatMap((k) => ["0x0", k.pub, ...sigOf(msgHash, k.priv)]),
    ];
  }
}

const deployer = deployerAccount();
const manifest = loadManifest();
const short = (s: string) => `${s.slice(0, 10)}…`;
const seedVar = "BRAMBLE_DATASET_SEED_READY_MATRIX";

const entryFor = (
  id: string,
  index: number,
  cls: string | null,
  expected: string,
  det: ManifestEntry["detectability"],
  backedBy: ManifestEntry["backedBy"],
  address: string,
  pub: string,
): ManifestEntry => {
  const e: ManifestEntry = manifest[id] ?? {
    id,
    seed: seedVar,
    vendorDerivation: "ready-double",
    index,
    address,
    pubkey: pub,
    classAtDeploy: cls,
    expected,
    detectability: det,
    backedBy,
    state: {},
    log: [],
  };
  manifest[id] = e;
  return e;
};

const ensureDeployed = async (kp: KP, cls: string, entry: ManifestEntry): Promise<void> => {
  const address = entry.address;
  if (await classAt(address)) return;
  const strk = await tokenBalance("STRK", address);
  if (strk < STRK_FLOAT) {
    const tx = await transfer(deployer, "STRK", address, STRK_FLOAT - strk);
    entry.log.push(`fee float ${tx}`);
  }
  const account = new Account({ provider, address, signer: kp.priv, cairoVersion: "1" });
  const { transaction_hash } = await account.deployAccount({
    classHash: cls,
    constructorCalldata: argentConstructor(kp.pub, cls),
    addressSalt: kp.pub,
  });
  await provider.waitForTransaction(transaction_hash);
  entry.log.push(`deployed ${transaction_hash}`);
  console.log(`   deployed: ${short(transaction_hash)}`);
};

const callOn = async (
  address: string,
  signer: Signer,
  entrypoint: string,
  calldata: string[],
  entry: ManifestEntry,
  label: string,
): Promise<void> => {
  const account = new Account({ provider, address, signer, cairoVersion: "1" });
  const { transaction_hash } = await account.execute({
    contractAddress: address,
    entrypoint,
    calldata,
  });
  await provider.waitForTransaction(transaction_hash);
  entry.log.push(`${label} ${transaction_hash}`);
  console.log(`   ${label}: ${short(transaction_hash)}`);
};

const view = async (address: string, entrypoint: string): Promise<string[]> =>
  provider.callContract({ contractAddress: address, entrypoint, calldata: [] }).catch(() => []);

const guardianOf = async (address: string): Promise<bigint> => {
  const r = await view(address, "get_guardian");
  return BigInt(r[0] ?? "0x0");
};

const run = async (
  id: string,
  fn: (entry: ManifestEntry) => Promise<FixtureOutcome>,
  entry: ManifestEntry,
): Promise<void> => {
  manifest[id] = await runFixture(entry, fn);
  saveManifest(manifest);
};

// 7 — USDC-only funded, undeployed (native USDC).
{
  const kp = readyKeypair(envSeed(seedVar), 7);
  const address = argentAddress(kp.pub, CLASSES.argent040);
  const entry = entryFor(
    "ready-matrix/7",
    7,
    null,
    "missed by ETH/STRK probe despite holding native USDC (needs richer probes)",
    "D3",
    "none",
    address,
    kp.pub,
  );
  await run(
    "ready-matrix/7",
    async (e) => {
      const bal = await tokenBalance("USDC", address);
      if (bal >= USDC_DUST) {
        console.log(`   already funded: ${bal}`);
      } else {
        const tx = await transfer(deployer, "USDC", address, USDC_DUST - bal);
        e.log.push(`funded USDC ${tx}`);
        console.log(`   funded USDC: ${short(tx)}`);
      }
      return { state: { deployed: false, funded: "USDC-native" } };
    },
    entry,
  );
}

// 3 — deployed at 0.3.0, upgraded to 0.4.0 (the Ready veteran).
{
  const kp = readyKeypair(envSeed(seedVar), 3);
  const address = argentAddress(kp.pub, CLASSES.argent030);
  const entry = entryFor(
    "ready-matrix/3",
    3,
    CLASSES.argent030,
    "address only derivable via the 0.3.0 shape; live class is 0.4.0",
    "D2",
    "none",
    address,
    kp.pub,
  );
  await run(
    "ready-matrix/3",
    async (e) => {
      await ensureDeployed(kp, CLASSES.argent030, e);
      const live = await classAt(address);
      if (live && BigInt(live) !== BigInt(CLASSES.argent040)) {
        await callOn(
          address,
          new LegacySigner([kp]),
          "upgrade",
          [CLASSES.argent040, "0x0"],
          e,
          "upgraded",
        );
      } else {
        console.log("   already upgraded");
      }
      return { state: { deployed: true, liveClass: await classAt(address) } };
    },
    entry,
  );
}

// 11 — guardian added after deploy (stays set).
{
  const kp = readyKeypair(envSeed(seedVar), 11);
  const address = argentAddress(kp.pub, CLASSES.argent040);
  const entry = entryFor(
    "ready-matrix/11",
    11,
    CLASSES.argent040,
    "found; signing must be refused while get_guardian != 0",
    "D2",
    "simulated",
    address,
    kp.pub,
  );
  await run(
    "ready-matrix/11",
    async (e) => {
      await ensureDeployed(kp, CLASSES.argent040, e);
      if ((await guardianOf(address)) === 0n) {
        await callOn(
          address,
          new LegacySigner([kp]),
          "change_guardian",
          ["0x0", "0x0", GUARDIAN.pub],
          e,
          "guardian set",
        );
      } else console.log("   guardian already set");
      return { state: { deployed: true, guardian: GUARDIAN.pub } };
    },
    entry,
  );
}

// 12 — guardian added, then removed (fully usable again).
{
  const kp = readyKeypair(envSeed(seedVar), 12);
  const address = argentAddress(kp.pub, CLASSES.argent040);
  const entry = entryFor(
    "ready-matrix/12",
    12,
    CLASSES.argent040,
    "found and signable; a cached guardian verdict would wrongly exclude it",
    "D2",
    "simulated",
    address,
    kp.pub,
  );
  await run(
    "ready-matrix/12",
    async (e) => {
      await ensureDeployed(kp, CLASSES.argent040, e);
      const g = await guardianOf(address);
      const everSet = e.log.some((l) => l.startsWith("guardian set"));
      if (g === 0n && !everSet) {
        await callOn(
          address,
          new LegacySigner([kp]),
          "change_guardian",
          ["0x0", "0x0", GUARDIAN.pub],
          e,
          "guardian set",
        );
      }
      if ((await guardianOf(address)) !== 0n) {
        await callOn(
          address,
          new LegacySigner([kp, GUARDIAN]),
          "change_guardian",
          ["0x1"],
          e,
          "guardian removed",
        );
      } else console.log("   guardian already removed");
      return { state: { deployed: true, guardian: null, hadGuardian: true } };
    },
    entry,
  );
}

// 13 — escape in progress (owner triggered guardian escape; left pending forever).
{
  const kp = readyKeypair(envSeed(seedVar), 13);
  const address = argentAddress(kp.pub, CLASSES.argent040);
  const entry = entryFor(
    "ready-matrix/13",
    13,
    CLASSES.argent040,
    "found; mid-escape account a wallet may import in-flight",
    "D2",
    "simulated",
    address,
    kp.pub,
  );
  await run(
    "ready-matrix/13",
    async (e) => {
      await ensureDeployed(kp, CLASSES.argent040, e);
      if ((await guardianOf(address)) === 0n) {
        await callOn(
          address,
          new LegacySigner([kp]),
          "change_guardian",
          ["0x0", "0x0", GUARDIAN.pub],
          e,
          "guardian set",
        );
      }
      const esc = await view(address, "get_escape");
      const pending = BigInt(esc[0] ?? "0x0") !== 0n;
      if (!pending) {
        await callOn(
          address,
          new LegacySigner([kp]),
          "trigger_escape_guardian",
          ["0x1"],
          e,
          "escape triggered",
        );
      } else console.log("   escape already pending");
      return {
        state: { deployed: true, guardian: GUARDIAN.pub, escape: "guardian-escape pending" },
      };
    },
    entry,
  );
}

// 14 — owner rotation, pass 1 of 2: guardian triggers owner escape (completes after the security period).
{
  const kp = readyKeypair(envSeed(seedVar), 14);
  const address = argentAddress(kp.pub, CLASSES.argent040);
  const entry = entryFor(
    "ready-matrix/14",
    14,
    CLASSES.argent040,
    "after pass 2 the live owner key is foreign to the seed (D5 for ownership)",
    "D5",
    "simulated",
    address,
    kp.pub,
  );
  await run(
    "ready-matrix/14",
    async (e) => {
      await ensureDeployed(kp, CLASSES.argent040, e);
      if ((await guardianOf(address)) === 0n) {
        await callOn(
          address,
          new LegacySigner([kp]),
          "change_guardian",
          ["0x0", "0x0", GUARDIAN.pub],
          e,
          "guardian set",
        );
      }
      const esc = await view(address, "get_escape");
      const pending = BigInt(esc[0] ?? "0x0") !== 0n;
      if (!pending) {
        await callOn(
          address,
          new ModernSigner([GUARDIAN]),
          "trigger_escape_owner",
          ["0x0", NEW_OWNER.pub],
          e,
          "owner escape triggered",
        );
      } else console.log("   owner escape already pending");
      return {
        state: {
          deployed: true,
          guardian: GUARDIAN.pub,
          escape: "owner-escape pending",
          newOwnerAfterPass2: NEW_OWNER.pub,
        },
      };
    },
    entry,
  );
}

console.log("\nstage C done; manifest written");
