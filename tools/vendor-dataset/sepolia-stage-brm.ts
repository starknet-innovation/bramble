/**
 * Sepolia fixtures on Bramble's own ladder (S-BRM, the 15/18/21-word phrases),
 * the standalone keys (K-OZ, K-SNC) and the Argent multisig pair, per the
 * import-paths scope doc's TA cards. OZ accounts use Krusty's 3.0.0 class and
 * salt 0 unless the card says otherwise.
 */
import { ec, hash } from "starknet";
import { brambleKeypair, CLASSES, classAt, deployerKeys } from "./matrix-lib";
import { type KP, ModernSigner } from "./matrix-signers";
import {
  invokeSelf,
  norm,
  type SepoliaFixture,
  STRK,
  selfDeploy,
  topUp,
  viewFelt,
} from "./sepolia-fixtures";
import { type SepoliaSecret, sepoliaSecret, sepoliaVar } from "./sepolia-seeds";

const { getStarkKey, poseidonHashMany } = ec.starkCurve;

// What `sncast account create --type oz` (0.59.0) picked for TA-07: the older
// OpenZeppelin class starknet-devnet also predeploys, and a random salt.
const SNCAST_OZ = "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";
const SNCAST_SALT = "0xfd6d011db255712d";

const ozAddress = (pub: string, salt = "0x0", classHash: string = CLASSES.oz300): string =>
  norm(hash.calculateContractAddressFromHash(salt, classHash, [pub], 0));
const keyPair = (priv: string): KP => ({ priv, pub: getStarkKey(priv) });

const brm = (account: number): KP => brambleKeypair(sepoliaSecret("S-BRM"), account);

/** A Bramble-ladder OZ account deployed with `salt` (0, or the card's override). */
function ozDeployed(
  id: string,
  seed: SepoliaSecret,
  kp: KP,
  account: number,
  expected: string,
  detectability: SepoliaFixture["detectability"],
  salt = "0x0",
): SepoliaFixture {
  return {
    id,
    seed: sepoliaVar(seed),
    vendorDerivation: "bramble-account",
    index: account,
    address: ozAddress(kp.pub, salt),
    pubkey: kp.pub,
    classAtDeploy: CLASSES.oz300,
    expected,
    detectability,
    backedBy: "none",
    step: async (e) => {
      const liveClass = await selfDeploy(e, {
        signer: kp.priv,
        classHash: CLASSES.oz300,
        calldata: [kp.pub],
        salt,
      });
      return { state: { deployed: true, salt, liveClass } };
    },
  };
}

// OZ AccountComponent: the new key signs poseidon('StarkNet Message',
// 'accept_ownership', account, current key) to accept the rotation.
const acceptOwnership = (address: string, current: string, next: KP): string[] => {
  const words = ["StarkNet Message", "accept_ownership"].map(
    (w) => `0x${Buffer.from(w).toString("hex")}`,
  );
  const msg = poseidonHashMany([...words, address, current].map(BigInt));
  const sig = ec.starkCurve.sign(`0x${msg.toString(16)}`, next.priv);
  return [next.pub, "0x2", `0x${sig.r.toString(16)}`, `0x${sig.s.toString(16)}`];
};

const rotated = brm(3);
const rotatedTo = keyPair(sepoliaSecret("K-ROT-O"));
const kOz = keyPair(sepoliaSecret("K-OZ"));
const kSnc = keyPair(sepoliaSecret("K-SNC"));

// Multisig seats: one on S-BRM (account 4), one on S-SCR (Bramble account 2),
// so importing either phrase holds a seat. Constructor hand-written as
// [threshold, n, (Signer::Starknet = 0, pubkey)×n] to stay independent of
// @bramble/multisig.
const seatA = brm(4);
const seatB = brambleKeypair(sepoliaSecret("S-SCR"), 2);
const multisigCalldata = (threshold: number, seats: readonly KP[]): string[] => [
  `0x${threshold.toString(16)}`,
  `0x${seats.length.toString(16)}`,
  ...seats.flatMap((s) => ["0x0", s.pub]),
];
const multisig = (id: string, salt: string, deploy: boolean, expected: string): SepoliaFixture => {
  const calldata = multisigCalldata(2, [seatA, seatB]);
  return {
    id,
    seed: `${sepoliaVar("S-BRM")} account 4 + ${sepoliaVar("S-SCR")} account 2`,
    vendorDerivation: "multisig",
    index: 0,
    address: norm(hash.calculateContractAddressFromHash(salt, CLASSES.multisig020, calldata, 0)),
    pubkey: seatA.pub,
    classAtDeploy: CLASSES.multisig020,
    expected,
    detectability: "D4",
    backedBy: "none",
    step: async (e) => {
      const base = { threshold: 2, seats: [seatA.pub, seatB.pub], salt };
      if (!deploy) return { state: { ...base, deployed: false } };
      // One seat's signature is enough to deploy (multisig __validate_deploy__).
      const liveClass = await selfDeploy(e, {
        signer: new ModernSigner([seatA]),
        classHash: CLASSES.multisig020,
        calldata,
        salt,
      });
      return { state: { ...base, deployed: true, liveClass } };
    },
  };
};

export const BRM_FIXTURES: readonly SepoliaFixture[] = [
  {
    id: "s-brm/TA-01",
    seed: sepoliaVar("S-BRM"),
    vendorDerivation: "bramble-account",
    index: 0,
    address: deployerKeys().address,
    pubkey: deployerKeys().pub,
    classAtDeploy: CLASSES.oz300,
    expected: "bank and deployer; found by the first-run scan as Bramble account 0",
    detectability: "D1",
    backedBy: "none",
    step: async (e) => {
      const liveClass = await classAt(e.address);
      if (!liveClass) throw new Error("not deployed: run deploy-deployer.ts first");
      return { state: { deployed: true, liveClass, role: "bank" } };
    },
  },
  {
    id: "s-brm/TA-02",
    seed: sepoliaVar("S-BRM"),
    vendorDerivation: "bramble-account",
    index: 1,
    address: ozAddress(brm(1).pub),
    pubkey: brm(1).pub,
    classAtDeploy: null,
    expected: "funded counterfactual: found by the STRK balance probe, deployable",
    detectability: "D1",
    backedBy: "none",
    step: async (e) => {
      await topUp(e, "STRK", STRK);
      return { state: { deployed: false, funded: "STRK" } };
    },
  },
  ozDeployed(
    "s-brm/TA-03",
    "S-BRM",
    brm(25),
    25,
    "past a 22-account gap: needs the advanced index (P5)",
    "D2",
  ),
  ozDeployed(
    "s-brm/TA-06",
    "S-BRM",
    brm(2),
    2,
    "OZ 3.0.0 with salt = pubkey: not the address Bramble derives (salt 0)",
    "D2",
    brm(2).pub,
  ),
  {
    id: "s-brm/TA-08",
    seed: sepoliaVar("S-BRM"),
    vendorDerivation: "bramble-account",
    index: 3,
    address: ozAddress(rotated.pub),
    pubkey: rotated.pub,
    classAtDeploy: CLASSES.oz300,
    expected: "owner rotated to K-ROT-O: the seed's key no longer signs for it",
    detectability: "D5",
    backedBy: "simulated",
    step: async (e) => {
      const liveClass = await selfDeploy(e, {
        signer: rotated.priv,
        classHash: CLASSES.oz300,
        calldata: [rotated.pub],
        salt: "0x0",
      });
      if ((await viewFelt(e.address, "get_public_key")) === BigInt(rotated.pub)) {
        await invokeSelf(
          e,
          rotated.priv,
          "set_public_key",
          acceptOwnership(e.address, rotated.pub, rotatedTo),
        );
      }
      return { state: { deployed: true, liveClass, owner: rotatedTo.pub } };
    },
  },
  {
    ...ozDeployed("key/TA-05", "K-OZ", kOz, 0, "standalone key import (P6) finds it", "D1"),
    vendorDerivation: "key",
  },
  {
    id: "key/TA-07",
    seed: sepoliaVar("K-SNC"),
    vendorDerivation: "key",
    index: 0,
    address: ozAddress(kSnc.pub, SNCAST_SALT, SNCAST_OZ),
    pubkey: kSnc.pub,
    classAtDeploy: SNCAST_OZ,
    expected: "made by sncast: another OZ class and a random salt; key import alone cannot find it",
    detectability: "D5",
    backedBy: "none",
    step: async (e) => {
      const liveClass = await selfDeploy(e, {
        signer: kSnc.priv,
        classHash: SNCAST_OZ,
        calldata: [kSnc.pub],
        salt: SNCAST_SALT,
      });
      return { state: { deployed: true, salt: SNCAST_SALT, liveClass } };
    },
  },
  ...(["S-W15", "S-W18", "S-W21"] as const).map((seed, i) =>
    ozDeployed(
      `phrase/TA-${42 + i}`,
      seed,
      brambleKeypair(sepoliaSecret(seed), 0),
      0,
      `${seed.slice(3)}-word phrase: valid BIP-39, account 0`,
      "D1",
    ),
  ),
  multisig("multisig/TA-39", "0x39", true, "deployed 2-of-2; P10 adds it by address"),
  multisig("multisig/TA-40", "0x40", false, "counterfactual 2-of-2: no class to read by address"),
];
