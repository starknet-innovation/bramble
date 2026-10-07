/**
 * Phase-3 stage D: the Braavos matrix core and the cross-vendor fixture.
 * Braavos self-deploy (from braavos-account-cairo BraavosBaseAccount): class is
 * the static deploy class, salt = pubkey, constructor [pubkey], and the
 * signature carries the real implementation out-of-band:
 *   [r_tx, s_tx, actual_impl, chain_id, r_aux, s_aux]
 * where (r_aux, s_aux) sign poseidon(actual_impl, chain_id). Idempotent.
 */
import { Account, Signer, ec, num, hash, constants } from "starknet";
import { poseidonHashMany } from "@scure/starknet";
import {
  braavosKeypair,
  CLASSES,
  classAt,
  deployerAccount,
  envSeed,
  loadManifest,
  type ManifestEntry,
  provider,
  readyKeypair,
  saveManifest,
  tokenBalance,
  TOKENS,
  transfer,
} from "./matrix-lib";

const BRAAVOS_IMPL_CURRENT = "0x3957f9f5a1cbfe918cedc2015c85200ca51a5f7506ecb6de98a5207b759bf8a";
const CHAIN_ID = constants.StarknetChainId.SN_MAIN;
const STRK_FLOAT = 2n * 10n ** 18n;
const STRK_DUST = 2n * 10n ** 18n;
const USDC_DUST = 2n * 10n ** 6n;

type KP = { priv: string; pub: string };

/**
 * Deploy-only signer producing Braavos' extended deploy signature:
 * [r_tx, s_tx, <AdditionalDeploymentParams: impl, signer_type, secp256r1 (u256 x2
 * = 4 felts), multisig_threshold, withdrawal_limit_low, fee_rate,
 * stark_fee_rate, chain_id>, r_aux, s_aux] with the aux pair signing
 * poseidon(params). Plain stark account: signer_type Empty (0), all zeros.
 */
class BraavosDeploySigner extends Signer {
  constructor(private kp: KP) {
    super(kp.priv);
  }
  override async signRaw(msgHash: string): Promise<string[]> {
    const tx = ec.starkCurve.sign(msgHash, this.kp.priv);
    const params = [
      BRAAVOS_IMPL_CURRENT,
      "0x0", // signer_type: Empty — no additional signer
      "0x0", "0x0", "0x0", "0x0", // secp256r1 pub_x/pub_y as two u256
      "0x0", // multisig_threshold
      "0x0", // withdrawal_limit_low
      "0x0", // fee_rate
      "0x0", // stark_fee_rate
      CHAIN_ID,
    ];
    const auxHash = "0x" + poseidonHashMany(params.map(BigInt)).toString(16);
    const aux = ec.starkCurve.sign(auxHash, this.kp.priv);
    return [num.toHex(tx.r), num.toHex(tx.s), ...params, num.toHex(aux.r), num.toHex(aux.s)];
  }
}

const braavosAddress = (pub: string): string =>
  "0x" + BigInt(hash.calculateContractAddressFromHash(pub, CLASSES.braavosDeploy, [pub], 0)).toString(16);

const deployer = deployerAccount();
const manifest = loadManifest();
const short = (s: string) => s.slice(0, 10) + "…";

const entryFor = (id: string, seedVar: string, derivation: ManifestEntry["vendorDerivation"], index: number, cls: string | null, expected: string, det: ManifestEntry["detectability"], address: string, pub: string): ManifestEntry => {
  const e: ManifestEntry = manifest[id] ?? {
    id, seed: seedVar, vendorDerivation: derivation, index, address, pubkey: pub,
    classAtDeploy: cls, expected, detectability: det, backedBy: "none", state: {}, log: [],
  };
  manifest[id] = e;
  return e;
};

const ensureBraavosDeployed = async (kp: KP, entry: ManifestEntry): Promise<void> => {
  const address = entry.address;
  if (await classAt(address)) return;
  const strk = await tokenBalance("STRK", address);
  if (strk < STRK_FLOAT) {
    const tx = await transfer(deployer, "STRK", address, STRK_FLOAT - strk);
    entry.log.push(`fee float ${tx}`);
  }
  const account = new Account({ provider, address, signer: new BraavosDeploySigner(kp), cairoVersion: "1" });
  // skipValidate must be off: Braavos' constructor parses the signature, so the
  // default SKIP_VALIDATE estimation (empty signature) reverts out-of-bounds.
  const { transaction_hash } = await account.deployAccount(
    {
      classHash: CLASSES.braavosDeploy,
      constructorCalldata: [kp.pub],
      addressSalt: kp.pub,
    },
    { skipValidate: false },
  );
  await provider.waitForTransaction(transaction_hash);
  entry.log.push(`deployed ${transaction_hash}`);
  console.log(`   deployed: ${short(transaction_hash)}`);
};

const run = async (id: string, fn: (e: ManifestEntry) => Promise<void>, entry: ManifestEntry): Promise<void> => {
  console.log(`\n== ${id} → ${short(entry.address)}`);
  try {
    await fn(entry);
  } catch (error) {
    entry.log.push(`ERROR: ${String(error).slice(0, 200)}`);
    entry.state = { ...entry.state, error: String(error).slice(0, 200) };
    console.log(`   FAILED: ${String(error).slice(0, 160)}`);
  }
  saveManifest(manifest);
};

const bSeed = envSeed("BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX");

// b0 — deployed plain.
{
  const kp = braavosKeypair(bSeed, 0);
  const e = entryFor("braavos-matrix/0", "BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX", "braavos-direct", 0, CLASSES.braavosDeploy,
    "found today at index 0 (the single overlapping coordinate), view-only", "D1", braavosAddress(kp.pub), kp.pub);
  await run("braavos-matrix/0", async (en) => {
    await ensureBraavosDeployed(kp, en);
    en.state = { deployed: true, liveClass: await classAt(en.address) };
  }, e);
}

// b1 — deployed at index 1 (lost to the axis mismatch today).
{
  const kp = braavosKeypair(bSeed, 1);
  const e = entryFor("braavos-matrix/1", "BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX", "braavos-direct", 1, CLASSES.braavosDeploy,
    "missed today (address axis); found once the scan walks the vendor axis", "D2", braavosAddress(kp.pub), kp.pub);
  await run("braavos-matrix/1", async (en) => {
    await ensureBraavosDeployed(kp, en);
    en.state = { deployed: true, liveClass: await classAt(en.address) };
  }, e);
}

// b2 — funded-undeployed STRK at index 2.
{
  const kp = braavosKeypair(bSeed, 2);
  const e = entryFor("braavos-matrix/2", "BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX", "braavos-direct", 2, null,
    "undeployed, STRK-funded on the vendor axis", "D2", braavosAddress(kp.pub), kp.pub);
  await run("braavos-matrix/2", async (en) => {
    const bal = await tokenBalance("STRK", en.address);
    if (bal < STRK_DUST) {
      const tx = await transfer(deployer, "STRK", en.address, STRK_DUST - bal);
      en.log.push(`funded STRK ${tx}`);
      console.log(`   funded STRK: ${short(tx)}`);
    } else console.log("   already funded");
    en.state = { deployed: false, funded: "STRK" };
  }, e);
}

// b3 — funded-undeployed native USDC at index 3 (D3).
{
  const kp = braavosKeypair(bSeed, 3);
  const e = entryFor("braavos-matrix/3", "BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX", "braavos-direct", 3, null,
    "undeployed, native-USDC only — invisible to the ETH/STRK probe", "D3", braavosAddress(kp.pub), kp.pub);
  await run("braavos-matrix/3", async (en) => {
    const bal = await tokenBalance("USDC", en.address);
    if (bal < USDC_DUST) {
      const tx = await transfer(deployer, "USDC", en.address, USDC_DUST - bal);
      en.log.push(`funded USDC ${tx}`);
      console.log(`   funded USDC: ${short(tx)}`);
    } else console.log("   already funded");
    en.state = { deployed: false, funded: "USDC-native" };
  }, e);
}

// cross — a Braavos-derived account on the READY matrix seed: one phrase, two vendors.
{
  const kp = braavosKeypair(envSeed("BRAMBLE_DATASET_SEED_READY_MATRIX"), 0);
  const e = entryFor("cross-vendor/braavos-0", "BRAMBLE_DATASET_SEED_READY_MATRIX", "braavos-direct", 0, CLASSES.braavosDeploy,
    "same seed also carries Ready accounts; a scanner must surface both families", "D1", braavosAddress(kp.pub), kp.pub);
  await run("cross-vendor/braavos-0", async (en) => {
    await ensureBraavosDeployed(kp, en);
    en.state = { deployed: true, liveClass: await classAt(en.address) };
  }, e);
}

console.log("\nstage D done; manifest written");
