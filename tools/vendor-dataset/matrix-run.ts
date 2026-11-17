/**
 * Phase-3 stage B: the Ready matrix core and the gaps seed. Idempotent — every
 * fixture declares its target chain state and the runner only performs missing
 * steps, so a crash or timeout mid-run is resumed by re-running. Spends from
 * the dataset deployer; all amounts are dust-sized. Prints addresses and tx
 * hashes only.
 */

import { Account } from "starknet";
import {
  argentAddress,
  argentConstructor,
  CLASSES,
  classAt,
  deployerAccount,
  envSeed,
  loadManifest,
  type ManifestEntry,
  provider,
  readyKeypair,
  saveManifest,
  type TOKENS,
  tokenBalance,
  transfer,
} from "./matrix-lib";

const STRK_FEE_FLOAT = 2n * 10n ** 18n; // 2 STRK sent to a fixture that must self-deploy
const STRK_DUST = 2n * 10n ** 18n;
const ETH_DUST = 5n * 10n ** 14n; // 0.0005 ETH

type Spec = {
  id: string;
  seedVar: string;
  index: number;
  cls: keyof typeof CLASSES | null; // null = never deployed
  fund?: { token: keyof typeof TOKENS; amount: bigint };
  empty?: boolean; // after deploy, send balance back (nonce > 0, near-zero)
  expected: string;
  detectability: ManifestEntry["detectability"];
};

const SPECS: Spec[] = [
  {
    id: "ready-matrix/0",
    seedVar: "BRAMBLE_DATASET_SEED_READY_MATRIX",
    index: 0,
    cls: "argent040",
    expected: "found once #505 fixed (0.4.0, deployed)",
    detectability: "D2",
  },
  {
    id: "ready-matrix/2",
    seedVar: "BRAMBLE_DATASET_SEED_READY_MATRIX",
    index: 2,
    cls: "argent030",
    expected: "found once #505 fixed (0.3.0, view-only)",
    detectability: "D2",
  },
  {
    id: "ready-matrix/4",
    seedVar: "BRAMBLE_DATASET_SEED_READY_MATRIX",
    index: 4,
    cls: "argent031",
    expected: "found once #505 fixed (0.3.1, view-only)",
    detectability: "D2",
  },
  {
    id: "ready-matrix/5",
    seedVar: "BRAMBLE_DATASET_SEED_READY_MATRIX",
    index: 5,
    cls: null,
    fund: { token: "ETH", amount: ETH_DUST },
    expected: "found once #505 fixed (undeployed, ETH balance probe)",
    detectability: "D2",
  },
  {
    id: "ready-matrix/6",
    seedVar: "BRAMBLE_DATASET_SEED_READY_MATRIX",
    index: 6,
    cls: null,
    fund: { token: "STRK", amount: STRK_DUST },
    expected: "found once #505 fixed (undeployed, STRK balance probe)",
    detectability: "D2",
  },
  {
    id: "ready-matrix/9",
    seedVar: "BRAMBLE_DATASET_SEED_READY_MATRIX",
    index: 9,
    cls: "argent040",
    empty: true,
    expected: "found once #505 fixed (deployed, used, near-zero balance)",
    detectability: "D2",
  },
  {
    id: "gaps/7",
    seedVar: "BRAMBLE_DATASET_SEED_GAPS",
    index: 7,
    cls: "argent040",
    expected: "found after a 7-index gap (#504 + #505)",
    detectability: "D2",
  },
  {
    id: "gaps/25",
    seedVar: "BRAMBLE_DATASET_SEED_GAPS",
    index: 25,
    cls: "argent040",
    expected: "found past the old 0-19 window only via #504's extension",
    detectability: "D3",
  },
];

const deployer = deployerAccount();
const manifest = loadManifest();
const short = (s: string) => `${s.slice(0, 10)}…`;

for (const spec of SPECS) {
  const kp = readyKeypair(envSeed(spec.seedVar), spec.index);
  const clsHash = spec.cls ? CLASSES[spec.cls] : CLASSES.argent040;
  const address = argentAddress(kp.pub, clsHash);
  const entry: ManifestEntry = manifest[spec.id] ?? {
    id: spec.id,
    seed: spec.seedVar,
    vendorDerivation: "ready-double",
    index: spec.index,
    address,
    pubkey: kp.pub,
    classAtDeploy: spec.cls ? clsHash : null,
    expected: spec.expected,
    detectability: spec.detectability,
    backedBy: "none",
    state: {},
    log: [],
  };
  manifest[spec.id] = entry;
  console.log(`\n== ${spec.id} → ${short(address)}`);

  try {
    // Funding-only fixtures: top up to the dust target and stop.
    if (!spec.cls) {
      if (!spec.fund) throw new Error(`${spec.id} has neither a class nor a funding target`);
      const { token, amount } = spec.fund;
      const bal = await tokenBalance(token, address);
      if (bal >= amount) {
        console.log(`   already funded: ${bal} ${token}`);
      } else {
        const tx = await transfer(deployer, token, address, amount - bal);
        entry.log.push(`funded ${token} ${tx}`);
        console.log(`   funded ${token}: ${short(tx)}`);
      }
      entry.state = { deployed: false, funded: spec.fund.token };
      saveManifest(manifest);
      continue;
    }

    // Deploying fixtures.
    let live = await classAt(address);
    if (!live) {
      const strk = await tokenBalance("STRK", address);
      if (strk < STRK_FEE_FLOAT) {
        const tx = await transfer(deployer, "STRK", address, STRK_FEE_FLOAT - strk);
        entry.log.push(`fee float ${tx}`);
        console.log(`   fee float sent: ${short(tx)}`);
      }
      const account = new Account({ provider, address, signer: kp.priv, cairoVersion: "1" });
      const { transaction_hash } = await account.deployAccount({
        classHash: clsHash,
        constructorCalldata: argentConstructor(kp.pub, clsHash),
        addressSalt: kp.pub,
      });
      await provider.waitForTransaction(transaction_hash);
      entry.log.push(`deployed ${transaction_hash}`);
      console.log(`   deployed: ${short(transaction_hash)}`);
      live = await classAt(address);
    } else {
      console.log(`   already deployed: ${short(live)}`);
    }

    if (spec.empty) {
      const strk = await tokenBalance("STRK", address);
      // Leave ~0.7 STRK for the sweep fee bound; the leftover is the fixture.
      const keep = 7n * 10n ** 17n;
      if (strk > keep) {
        const account = new Account({ provider, address, signer: kp.priv, cairoVersion: "1" });
        const tx = await transfer(account, "STRK", deployer.address, strk - keep);
        entry.log.push(`swept ${tx}`);
        console.log(`   swept back: ${short(tx)}`);
      } else {
        console.log(`   already swept (${strk} left)`);
      }
    }
    entry.state = { deployed: true, liveClass: live };
    saveManifest(manifest);
  } catch (error) {
    entry.log.push(`ERROR: ${String(error).slice(0, 200)}`);
    entry.state = { ...entry.state, error: String(error).slice(0, 200) };
    saveManifest(manifest);
    console.log(`   FAILED: ${String(error).slice(0, 160)}`);
  }
}

console.log("\nmanifest written");
