/**
 * Sepolia fixtures on S-LDG, the dedicated test Ledger (step 4 of issue 821).
 * The tooling derives the device's keys from its phrase (ledgerKeypair), checked
 * against the addresses Bramble showed for the device. TA-32 is Bramble's own
 * Ledger account (LedgerW index 0, OZ 3.0.0, salt 0), funded here and deployed
 * from Bramble on the device. Runs only once the seed file holds S-LDG.
 */
import { hash } from "starknet";
import { CLASSES, ledgerKeypair } from "./matrix-lib";
import { appSeed, fundForApp, norm, type SepoliaFixture, STRK } from "./sepolia-fixtures";
import { sepoliaVar } from "./sepolia-seeds";

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
  ];
};

const ldgSeed = appSeed("S-LDG", "TA-32…TA-37");

export const LDG_FIXTURES: readonly SepoliaFixture[] = ldgSeed ? ldgFixtures(ldgSeed) : [];
