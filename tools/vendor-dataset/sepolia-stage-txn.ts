/**
 * Sepolia accounts on S-TXN, the nightly send suite's own seed (issue 976):
 * one deployed account per signing shape the wallet imports, so the suite can
 * self-transfer from each without ever touching an import fixture, plus TX-00,
 * the bank that funds the suite's throwaway deploy accounts. All funded by TA-01.
 *
 * Re-running tops every sender back up to its float, so a local run of this
 * stage is also how the suite is refilled. Without S-TXN in the seed file the
 * stage is skipped, so the other stages keep running.
 */
import { hash } from "starknet";
import {
  argentConstructor,
  braavosKeypair,
  brambleKeypair,
  CLASSES,
  type ManifestEntry,
  offLadderKeypair,
  readyKeypair,
} from "./matrix-lib";
import { BraavosDeploySigner, type KP } from "./matrix-signers";
import {
  appSeed,
  norm,
  type SepoliaFixture,
  STRK,
  selfDeploy,
  topUp,
  upgradeTo,
} from "./sepolia-fixtures";
import { sepoliaVar } from "./sepolia-seeds";
import { braavosDeployParams } from "./sepolia-stage-brv";

// ponytail: floats are guesses until the suite's first local run measures one
// night's cost (#976, PR 3); raise them then, and the nightly flags a low bank.
const BANK_FLOAT = 20n * STRK;
const SENDER_FLOAT = 2n * STRK;
const ETH_FLOAT = 10n ** 15n; // 0.001 ETH, for TX-01's one ETH self-transfer
// TX-10's salt, standing in for the random one sncast picks.
const SNCAST_SALT = "0x7c10";

/** A deploy shape: class, constructor calldata and salt, plus the deploy signer. */
type Shape = {
  readonly classHash: string;
  readonly calldata: readonly string[];
  readonly salt: string;
  readonly signer?: BraavosDeploySigner;
};

const oz = (kp: KP, salt = "0x0", classHash: string = CLASSES.oz300): Shape => ({
  classHash,
  calldata: [kp.pub],
  salt,
});
const argent = (kp: KP, classHash: string): Shape => ({
  classHash,
  calldata: argentConstructor(kp.pub, classHash),
  salt: kp.pub,
});
const braavos = (kp: KP, impl: string): Shape => ({
  classHash: CLASSES.braavosDeploy,
  calldata: [kp.pub],
  salt: kp.pub,
  signer: new BraavosDeploySigner(kp, braavosDeployParams(false, impl)),
});

/** One S-TXN account: deployed once, then kept at `float` STRK (and ETH, when given). */
function sender(
  seed: string,
  id: string,
  derivation: ManifestEntry["vendorDerivation"],
  index: number,
  kp: KP,
  shape: Shape,
  card: {
    readonly expected: string;
    readonly detectability: ManifestEntry["detectability"];
    readonly float?: bigint;
    readonly eth?: bigint;
    readonly after?: (e: ManifestEntry) => Promise<Record<string, unknown>>;
  },
): SepoliaFixture {
  return {
    id,
    seed,
    vendorDerivation: derivation,
    index,
    address: norm(
      hash.calculateContractAddressFromHash(shape.salt, shape.classHash, [...shape.calldata], 0),
    ),
    pubkey: kp.pub,
    classAtDeploy: shape.classHash,
    expected: card.expected,
    detectability: card.detectability,
    backedBy: "none",
    step: async (e) => {
      const liveClass = await selfDeploy(e, {
        signer: shape.signer ?? kp.priv,
        classHash: shape.classHash,
        calldata: shape.calldata,
        salt: shape.salt,
      });
      // A shape that computes a different address than the deploy used would
      // leave the recorded address empty; never record that as deployed.
      if (!liveClass) throw new Error(`no class at ${e.address} after deploy`);
      const extra = card.after ? await card.after(e) : {};
      await topUp(e, "STRK", card.float ?? SENDER_FLOAT);
      if (card.eth) await topUp(e, "ETH", card.eth);
      return { state: { deployed: true, salt: shape.salt, liveClass, ...extra } };
    },
  };
}

const fixtures = (mnemonic: string): readonly SepoliaFixture[] => {
  const seed = sepoliaVar("S-TXN");
  const bramble = (account: number): KP => brambleKeypair(mnemonic, account);
  const ready = (index: number): KP => readyKeypair(mnemonic, index);
  const brv = (index: number): KP => braavosKeypair(mnemonic, index);
  const key = (index: number): KP => offLadderKeypair(mnemonic, index);
  return [
    sender(seed, "s-txn/TX-00", "bramble-account", 0, bramble(0), oz(bramble(0)), {
      expected:
        "the send suite's bank: funds its throwaway deploy accounts; never sent from in the UI",
      detectability: "D1",
      float: BANK_FLOAT,
    }),
    sender(seed, "s-txn/TX-01", "bramble-account", 1, bramble(1), oz(bramble(1)), {
      expected: "sends: Bramble OZ 3.0 (STRK and ETH)",
      detectability: "D1",
      eth: ETH_FLOAT,
    }),
    sender(
      seed,
      "s-txn/TX-02",
      "bramble-account",
      2,
      bramble(2),
      argent(bramble(2), CLASSES.argent040),
      { expected: "sends: Argent 0.4 on Bramble's ladder", detectability: "D1" },
    ),
    sender(
      seed,
      "s-txn/TX-03",
      "bramble-account",
      3,
      bramble(3),
      argent(bramble(3), CLASSES.xverse040),
      { expected: "sends: Xverse Argent 0.4 on Bramble's ladder", detectability: "D1" },
    ),
    sender(seed, "s-txn/TX-04", "ready-double", 0, ready(0), argent(ready(0), CLASSES.argent040), {
      expected: "sends: Ready Argent 0.4",
      detectability: "D1",
    }),
    sender(seed, "s-txn/TX-05", "ready-double", 1, ready(1), argent(ready(1), CLASSES.argent031), {
      expected: "sends: Ready Argent 0.3.1",
      detectability: "D2",
    }),
    sender(seed, "s-txn/TX-06", "ready-double", 2, ready(2), argent(ready(2), CLASSES.argent040), {
      expected: "Ready Argent 0.4 upgraded to 0.5.0: send or refusal set by the suite's first run",
      detectability: "D2",
      after: upgradeTo(CLASSES.argent050, ready(2)),
    }),
    sender(seed, "s-txn/TX-07", "braavos-direct", 0, brv(0), braavos(brv(0), CLASSES.braavosImpl), {
      expected: "sends: Braavos, current implementation",
      detectability: "D2",
    }),
    sender(
      seed,
      "s-txn/TX-08",
      "braavos-direct",
      1,
      brv(1),
      braavos(brv(1), CLASSES.braavosImpl110),
      {
        expected: "Braavos 1.1.0 implementation: send or refusal set by the suite's first run",
        detectability: "D2",
      },
    ),
    sender(seed, "s-txn/TX-09", "key", 0, key(0), oz(key(0)), {
      expected: "sends: OZ 3.0 imported by private key",
      detectability: "D1",
    }),
    sender(seed, "s-txn/TX-10", "key", 1, key(1), oz(key(1), SNCAST_SALT, CLASSES.ozSncast), {
      expected: "sends: sncast's OZ class and salt, imported by key and address",
      detectability: "D5",
    }),
  ];
};

const mnemonic = appSeed("S-TXN", "TX-00…TX-10");

/** S-TXN's fixtures, or none until the seed is in the seed file. */
export const TXN_FIXTURES: readonly SepoliaFixture[] = mnemonic ? fixtures(mnemonic) : [];
