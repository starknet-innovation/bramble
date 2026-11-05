/**
 * Sepolia fixtures on S-LDG, the dedicated test Ledger (step 4 of issue 821).
 * The tooling derives the device's keys from its phrase (ledgerKeypair), checked
 * against the addresses Bramble showed for the device. TA-32 is Bramble's own
 * Ledger account (LedgerW index 0, OZ 3.0.0, salt 0) and TA-33 Ready's (argentx
 * index 0, Argent 0.4.0): funded here, deployed from the apps on the device.
 * TA-34…TA-37 sit on the argentx ladder and are shaped here from the derived
 * keys, as the Ledger app would sign: Braavos, a funded counterfactual, a
 * guardian, and Argent 0.3.1. Runs only once the seed file holds S-LDG.
 */
import { hash } from "starknet";
import { argentAddress, argentConstructor, CLASSES, ledgerKeypair } from "./matrix-lib";
import { BraavosDeploySigner } from "./matrix-signers";
import {
  appSeed,
  fundForApp,
  norm,
  type SepoliaFixture,
  STRK,
  selfDeploy,
  topUp,
} from "./sepolia-fixtures";
import { sepoliaVar } from "./sepolia-seeds";
import { braavosDeployParams } from "./sepolia-stage-brv";
import { guardianStep } from "./sepolia-stage-rdy";

type Card = Pick<SepoliaFixture, "expected" | "detectability" | "backedBy" | "classAtDeploy">;

/** A Ready-ladder (argentx) Ledger account at `index`, addressed as `cls` would deploy it. */
const argentxFixture = (
  seed: string,
  id: string,
  index: number,
  cls: string,
  card: Card,
  step: (kp: { priv: string; pub: string }) => SepoliaFixture["step"],
): SepoliaFixture => {
  const kp = ledgerKeypair(seed, "argentx", index);
  const address =
    cls === CLASSES.braavosDeploy
      ? norm(hash.calculateContractAddressFromHash(kp.pub, cls, [kp.pub], 0))
      : argentAddress(kp.pub, cls);
  return {
    id,
    seed: sepoliaVar("S-LDG"),
    vendorDerivation: "ledger-argentx",
    index,
    address,
    pubkey: kp.pub,
    ...card,
    step: step(kp),
  };
};

const deployArgent =
  (cls: string) =>
  (kp: { priv: string; pub: string }): SepoliaFixture["step"] =>
  async (e) => {
    const liveClass = await selfDeploy(e, {
      signer: kp.priv,
      classHash: cls,
      calldata: argentConstructor(kp.pub, cls),
      salt: kp.pub,
    });
    return { state: { deployed: true, liveClass } };
  };

const ldgFixtures = (seed: string): SepoliaFixture[] => {
  const ta32 = ledgerKeypair(seed, "ledgerw", 0);
  return [
    {
      id: "s-ldg/TA-32",
      seed: sepoliaVar("S-LDG"),
      vendorDerivation: "ledgerw",
      index: 0,
      address: norm(hash.calculateContractAddressFromHash("0x0", CLASSES.oz300, [ta32.pub], 0)),
      pubkey: ta32.pub,
      classAtDeploy: CLASSES.oz300,
      expected: "Bramble Ledger OZ: listed by 'Ledger account' and the first-run scan",
      detectability: "D1",
      backedBy: "none",
      step: fundForApp(STRK, "Bramble (Ledger)"),
    },
    argentxFixture(
      seed,
      "s-ldg/TA-33",
      0,
      CLASSES.argent040,
      {
        expected: "Ready Ledger 0.4.0, deployed by Ready: listed under 'Ready Ledger account'",
        detectability: "D1",
        backedBy: "none",
        classAtDeploy: CLASSES.argent040,
      },
      () => fundForApp(STRK, "Ready (Ledger)"),
    ),
    argentxFixture(
      seed,
      "s-ldg/TA-34",
      1,
      CLASSES.braavosDeploy,
      {
        expected: "Braavos on the argentx Ledger ladder: only under 'Ready Ledger account' (N12)",
        detectability: "D2",
        backedBy: "none",
        classAtDeploy: CLASSES.braavosDeploy,
      },
      (kp) => async (e) => {
        const liveClass = await selfDeploy(e, {
          signer: new BraavosDeploySigner(kp, braavosDeployParams(false)),
          classHash: CLASSES.braavosDeploy,
          calldata: [kp.pub],
          salt: kp.pub,
        });
        return { state: { deployed: true, liveClass } };
      },
    ),
    argentxFixture(
      seed,
      "s-ldg/TA-35",
      2,
      CLASSES.argent040,
      {
        expected: "Ready Ledger funded counterfactual: activity unproven on Sepolia (N11)",
        detectability: "D1",
        backedBy: "none",
        classAtDeploy: null,
      },
      () => async (e) => {
        await topUp(e, "STRK", STRK);
        return { state: { deployed: false, funded: "STRK" } };
      },
    ),
    argentxFixture(
      seed,
      "s-ldg/TA-36",
      3,
      CLASSES.argent040,
      {
        expected: "Ready Ledger with a guardian: selectable, no restriction label (N2)",
        detectability: "D2",
        backedBy: "simulated",
        classAtDeploy: CLASSES.argent040,
      },
      (kp) => guardianStep(kp, false),
    ),
    argentxFixture(
      seed,
      "s-ldg/TA-37",
      4,
      CLASSES.argent031,
      {
        expected: "Ready Ledger on Argent 0.3.1: not found (N2, one class)",
        detectability: "D2",
        backedBy: "none",
        classAtDeploy: CLASSES.argent031,
      },
      deployArgent(CLASSES.argent031),
    ),
  ];
};

const ldgSeed = appSeed("S-LDG", "TA-32…TA-37");

export const LDG_FIXTURES: readonly SepoliaFixture[] = ldgSeed ? ldgFixtures(ldgSeed) : [];
