/**
 * Phase-3 stage E: Braavos 2FA-at-deploy, the D4 shapes (custom salt, UDC
 * third-party deploy) and the D5 funded counterfactual
 * fixture, a Bramble-axis control, and the R1/B1 ground-truth accounts folded
 * into the manifest. Idempotent; dust-sized; prints public data only.
 */

import { createECDH } from "node:crypto";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { Account, constants, ec, hash, num, Signer, uint256 } from "starknet";
import { envLines } from "./dataset-env";
import {
  argentAddress,
  argentConstructor,
  braavosKeypair,
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

const { grindKey, getStarkKey, poseidonHashMany } = ec.starkCurve;

const IMPL = "0x3957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a";
const CHAIN_ID = constants.StarknetChainId.SN_MAIN;
const UDC = "0x041a78e741e5af2fec34b695679bc6891742439f7afb8484ecd7766661ad02bf";
const STRK_FLOAT = 2n * 10n ** 18n;

type KP = { priv: string; pub: string };

const deployer = deployerAccount();
const manifest = loadManifest();
const short = (s: string) => `${s.slice(0, 10)}…`;
const norm = (a: string) => `0x${BigInt(a).toString(16)}`;

// Order n of the P-256 (secp256r1) group, SEC 2 section 2.4.2.
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// Deterministic secp256r1 (P-256) key for the simulated 2FA signer: deployer
// seed child 3's grinded key reduced into the P-256 scalar field.
const r1Key = (() => {
  const node = HDKey.fromMasterSeed(
    mnemonicToSeedSync(envSeed("BRAMBLE_DATASET_SEED_DEPLOYER")),
  ).derive("m/44'/9004'/0'/0/3");
  if (!node.privateKey) throw new Error("derivation failed");
  const scalar = (BigInt(`0x${grindKey(node.privateKey)}`) % (P256_ORDER - 1n)) + 1n;
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(scalar.toString(16).padStart(64, "0"), "hex"));
  const point = ecdh.getPublicKey(); // uncompressed: 0x04 || x (32 bytes) || y (32 bytes)
  return {
    x: BigInt(`0x${point.subarray(1, 33).toString("hex")}`),
    y: BigInt(`0x${point.subarray(33, 65).toString("hex")}`),
  };
})();
const u256felts = (v: bigint): [string, string] => {
  const u = uint256.bnToUint256(v);
  return [num.toHex(u.low), num.toHex(u.high)];
};

class BraavosDeploySigner extends Signer {
  constructor(
    private kp: KP,
    private params: string[],
  ) {
    super(kp.priv);
  }
  override async signRaw(msgHash: string): Promise<string[]> {
    const tx = ec.starkCurve.sign(msgHash, this.kp.priv);
    const auxHash = `0x${poseidonHashMany(this.params.map(BigInt)).toString(16)}`;
    const aux = ec.starkCurve.sign(auxHash, this.kp.priv);
    return [num.toHex(tx.r), num.toHex(tx.s), ...this.params, num.toHex(aux.r), num.toHex(aux.s)];
  }
}

const twoFaParams = (): string[] => [
  IMPL,
  "0x2", // SignerType::Secp256r1
  ...u256felts(r1Key.x),
  ...u256felts(r1Key.y),
  "0x0", // multisig_threshold
  "0x0", // withdrawal_limit_low
  "0x0",
  "0x0", // fee rates
  CHAIN_ID,
];

const entryFor = (
  id: string,
  seedVar: string,
  derivation: ManifestEntry["vendorDerivation"],
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
    vendorDerivation: derivation,
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

const run = async (
  id: string,
  fn: (entry: ManifestEntry) => Promise<FixtureOutcome>,
  entry: ManifestEntry,
): Promise<void> => {
  manifest[id] = await runFixture(entry, fn);
  saveManifest(manifest);
};

const ensureFloat = async (address: string, entry: ManifestEntry): Promise<void> => {
  const strk = await tokenBalance("STRK", address);
  if (strk < STRK_FLOAT) {
    const tx = await transfer(deployer, "STRK", address, STRK_FLOAT - strk);
    entry.log.push(`fee float ${tx}`);
  }
};

// ── braavos-matrix/4: 2FA (secp256r1 additional signer) at deploy ──
{
  const kp = braavosKeypair(envSeed("BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX"), 4);
  const address = norm(
    hash.calculateContractAddressFromHash(kp.pub, CLASSES.braavosDeploy, [kp.pub], 0),
  );
  const e = entryFor(
    "braavos-matrix/4",
    "BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX",
    "braavos-direct",
    4,
    CLASSES.braavosDeploy,
    "found by address; stark-key signing must be refused while the strong signer is active",
    "D2",
    "simulated",
    address,
    kp.pub,
  );
  await run(
    "braavos-matrix/4",
    async (en) => {
      if (!(await classAt(address))) {
        await ensureFloat(address, en);
        const account = new Account({
          provider,
          address,
          signer: new BraavosDeploySigner(kp, twoFaParams()),
          cairoVersion: "1",
        });
        const { transaction_hash } = await account.deployAccount(
          { classHash: CLASSES.braavosDeploy, constructorCalldata: [kp.pub], addressSalt: kp.pub },
          { skipValidate: false },
        );
        await provider.waitForTransaction(transaction_hash);
        en.log.push(`deployed-with-2fa ${transaction_hash}`);
        console.log(`   deployed with 2FA: ${short(transaction_hash)}`);
      } else console.log("   already deployed");
      return {
        state: {
          deployed: true,
          liveClass: await classAt(address),
          secp256r1: { x: num.toHex(r1Key.x), y: num.toHex(r1Key.y) },
        },
      };
    },
    e,
  );
}

// ── ready-matrix/16: custom salt self-deploy (D4) ──
{
  const kp = readyKeypair(envSeed("BRAMBLE_DATASET_SEED_READY_MATRIX"), 16);
  const SALT = "0xb4a3b1e5a17";
  const address = norm(
    hash.calculateContractAddressFromHash(
      SALT,
      CLASSES.argent040,
      argentConstructor(kp.pub, CLASSES.argent040),
      0,
    ),
  );
  const e = entryFor(
    "ready-matrix/16",
    "BRAMBLE_DATASET_SEED_READY_MATRIX",
    "ready-double",
    16,
    CLASSES.argent040,
    "seed-owned key, unguessable address (salt != pubkey) — indexer-only",
    "D4",
    "none",
    address,
    kp.pub,
  );
  await run(
    "ready-matrix/16",
    async (en) => {
      if (!(await classAt(address))) {
        await ensureFloat(address, en);
        const account = new Account({ provider, address, signer: kp.priv, cairoVersion: "1" });
        const { transaction_hash } = await account.deployAccount({
          classHash: CLASSES.argent040,
          constructorCalldata: argentConstructor(kp.pub, CLASSES.argent040),
          addressSalt: SALT,
        });
        await provider.waitForTransaction(transaction_hash);
        en.log.push(`deployed ${transaction_hash}`);
        console.log(`   deployed: ${short(transaction_hash)}`);
      } else console.log("   already deployed");
      return { state: { deployed: true, salt: SALT, liveClass: await classAt(address) } };
    },
    e,
  );
}

// ── ready-matrix/17: deployed by a third party through the UDC, unique=1 (D4) ──
{
  const kp = readyKeypair(envSeed("BRAMBLE_DATASET_SEED_READY_MATRIX"), 17);
  const e = entryFor(
    "ready-matrix/17",
    "BRAMBLE_DATASET_SEED_READY_MATRIX",
    "ready-double",
    17,
    CLASSES.argent040,
    "deployed by the dataset deployer via UDC unique=1 — deployer folds into the address",
    "D4",
    "none",
    "0x0",
    kp.pub,
  );
  await run(
    "ready-matrix/17",
    async (en) => {
      if (en.state["deployed"] !== true) {
        const { transaction_hash } = await deployer.execute({
          contractAddress: UDC,
          entrypoint: "deployContract",
          calldata: [
            CLASSES.argent040,
            kp.pub, // salt
            "0x1", // unique
            "0x3",
            ...argentConstructor(kp.pub, CLASSES.argent040),
          ],
        });
        const receipt = await provider.waitForTransaction(transaction_hash);
        en.log.push(`udc-deployed ${transaction_hash}`);
        const deployedEvent = (
          receipt as { events?: { from_address: string; keys: string[]; data: string[] }[] }
        ).events?.find((ev) => BigInt(ev.from_address) === BigInt(UDC));
        const deployedAt = deployedEvent?.data[0];
        const addr = deployedAt ? norm(deployedAt) : "0x0";
        console.log(`   UDC deployed at: ${short(addr)}`);
        return {
          address: addr,
          state: { deployed: true, deployedBy: "UDC unique=1", liveClass: await classAt(addr) },
        };
      }
      console.log("   already deployed");
      return { state: en.state };
    },
    e,
  );
}

// ── ready-matrix/18: custom-salt counterfactual, funded, never deployed (D5) ──
{
  const kp = readyKeypair(envSeed("BRAMBLE_DATASET_SEED_READY_MATRIX"), 18);
  const SALT = "0x5eed5a17";
  const address = norm(
    hash.calculateContractAddressFromHash(
      SALT,
      CLASSES.argent040,
      argentConstructor(kp.pub, CLASSES.argent040),
      0,
    ),
  );
  const e = entryFor(
    "ready-matrix/18",
    "BRAMBLE_DATASET_SEED_READY_MATRIX",
    "ready-double",
    18,
    null,
    "funded at a custom-salt counterfactual — invisible from the seed by any method",
    "D5",
    "none",
    address,
    kp.pub,
  );
  await run(
    "ready-matrix/18",
    async (en) => {
      const bal = await tokenBalance("STRK", address);
      const dust = 1n * 10n ** 18n;
      if (bal < dust) {
        const tx = await transfer(deployer, "STRK", address, dust - bal);
        en.log.push(`funded ${tx}`);
        console.log(`   funded: ${short(tx)}`);
      } else console.log("   already funded");
      return { state: { deployed: false, salt: SALT, funded: "STRK" } };
    },
    e,
  );
}

// ── control/bramble-axis-1: Bramble's own account-axis ladder, index 1 (D1) ──
{
  const node = HDKey.fromMasterSeed(
    mnemonicToSeedSync(envSeed("BRAMBLE_DATASET_SEED_READY_MATRIX")),
  ).derive("m/44'/9004'/1'/0/0");
  if (!node.privateKey) throw new Error("derivation failed");
  const priv = `0x${grindKey(node.privateKey)}`;
  const kp = { priv, pub: getStarkKey(priv) };
  const address = argentAddress(kp.pub, CLASSES.argent040);
  const e = entryFor(
    "control/bramble-axis-1",
    "BRAMBLE_DATASET_SEED_READY_MATRIX",
    "braavos-direct",
    1,
    CLASSES.argent040,
    "control: on Bramble's current ladder, so today's scan MUST find it",
    "D1",
    "none",
    address,
    kp.pub,
  );
  await run(
    "control/bramble-axis-1",
    async (en) => {
      if (!(await classAt(address))) {
        await ensureFloat(address, en);
        const account = new Account({ provider, address, signer: kp.priv, cairoVersion: "1" });
        const { transaction_hash } = await account.deployAccount({
          classHash: CLASSES.argent040,
          constructorCalldata: argentConstructor(kp.pub, CLASSES.argent040),
          addressSalt: kp.pub,
        });
        await provider.waitForTransaction(transaction_hash);
        en.log.push(`deployed ${transaction_hash}`);
        console.log(`   deployed: ${short(transaction_hash)}`);
      } else console.log("   already deployed");
      return { state: { deployed: true, liveClass: await classAt(address) } };
    },
    e,
  );
}

// ── ground truth: fold the R1/B1 app-made accounts into the manifest ──
{
  const text = envLines();
  let section = "";
  const gt: { vendor: string; n: number; address: string }[] = [];
  for (const line of text) {
    if (line.includes("READY_MAIN")) section = "ready";
    else if (line.includes("BRAAVOS_MAIN")) section = "braavos";
    else if (line.includes("SEED_CROSS")) section = "";
    const [, n, address] = line.match(/account (\d+) address:\s*(0x[0-9a-fA-F]+)/) ?? [];
    if (n && address && section) gt.push({ vendor: section, n: Number(n), address: norm(address) });
  }
  const notes: Record<
    string,
    {
      idx: number;
      det: ManifestEntry["detectability"];
      backed: ManifestEntry["backedBy"];
      expected: string;
    }
  > = {
    "ready-1": { idx: 0, det: "D2", backed: "none", expected: "app-made, deployed 0.4.0" },
    "ready-2": {
      idx: 1,
      det: "D4",
      backed: "vendor-backend",
      expected: "smart account, backend salt; guardian 0x7601f48c…",
    },
    "ready-3": {
      idx: 2,
      det: "D5",
      backed: "vendor-backend",
      expected: "discarded in the Ready UI, empty; still the seed's account",
    },
    "ready-4": { idx: 4, det: "D2", backed: "none", expected: "app-recorded, untouched" },
    "ready-5": { idx: 5, det: "D2", backed: "none", expected: "app-recorded, untouched" },
    "braavos-1": {
      idx: 0,
      det: "D1",
      backed: "vendor-backend",
      expected: "app-made, deployed, 2FA (+3FA if enrolled)",
    },
    "braavos-2": { idx: 1, det: "D2", backed: "none", expected: "app-made, deployed plain" },
    "braavos-3": { idx: 2, det: "D3", backed: "none", expected: "app-made, 2.3 STRK, undeployed" },
    "braavos-4": { idx: 3, det: "D2", backed: "none", expected: "app-recorded, untouched" },
  };
  for (const { vendor, n, address } of gt) {
    const key = `${vendor}-${n}`;
    const meta = notes[key];
    if (!meta) continue;
    const id = `ground-truth/${key}`;
    const seedVar =
      vendor === "ready" ? "BRAMBLE_DATASET_SEED_READY_MAIN" : "BRAMBLE_DATASET_SEED_BRAAVOS_MAIN";
    const entry = entryFor(
      id,
      seedVar,
      vendor === "ready" ? "ready-double" : "braavos-direct",
      meta.idx,
      null,
      meta.expected,
      meta.det,
      meta.backed,
      address,
      "",
    );
    entry.state = { ...entry.state, appMade: true, liveClass: await classAt(address) };
    console.log(
      `ground-truth ${key}: ${short(address)} ${entry.state["liveClass"] ? "deployed" : "undeployed"}`,
    );
  }
  saveManifest(manifest);
}

console.log("\nstage E done; manifest written");
