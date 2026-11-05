/**
 * Sepolia fixtures on S-RDY, the phrase made in the Ready extension (step 3 of
 * issue 821): TA-09…TA-13 at Ready ladder indices 0…4, Argent 0.4.0 at
 * salt = pubkey as Ready deploys them. The app made the accounts; this stage
 * funds them, deploys TA-11's test token, and shapes the guardian states.
 * TA-09 is deployed from the Ready app itself, so here it is only funded.
 * Also S-XVS, the phrase made in the Xverse extension: TA-26 at the own
 * ladder's index 0 on the Xverse class, funded here and deployed by the app.
 * Each group runs only once the seed file holds its phrase.
 */
import { byteArray, CallData, cairo, ec, hash } from "starknet";
import {
  argentAddress,
  argentConstructor,
  brambleKeypair,
  CLASSES,
  classAt,
  type ManifestEntry,
  provider,
  readyKeypair,
  UDC,
} from "./matrix-lib";
import { LegacySigner } from "./matrix-signers";
import {
  appSeed,
  deployer,
  fundForApp,
  invokeSelf,
  type SepoliaFixture,
  STRK,
  selfDeploy,
  topUp,
  viewFelt,
} from "./sepolia-fixtures";
import { sepoliaSecret, sepoliaVar } from "./sepolia-seeds";

// OpenZeppelin Contracts for Cairo 3.x ERC20Upgradeable preset, declared on Sepolia:
// constructor(name, symbol, fixed_supply: u256, recipient, owner).
const OZ_ERC20 = "0x0385b75aa04cfee201d2e2de42daf00a839367cfd740e9042766b447d891fea0";
const TOKEN_SALT = "0x11e20";

const GUARDIAN = (() => {
  const priv = sepoliaSecret("K-GRD");
  return { priv, pub: ec.starkCurve.getStarkKey(priv) };
})();

type Card = Pick<SepoliaFixture, "expected" | "detectability" | "backedBy" | "classAtDeploy">;

function readyFixture(
  seed: string,
  id: string,
  index: number,
  card: Card,
  step: SepoliaFixture["step"],
): SepoliaFixture {
  const kp = readyKeypair(seed, index);
  return {
    id,
    seed: sepoliaVar("S-RDY"),
    vendorDerivation: "ready-double",
    index,
    address: argentAddress(kp.pub, CLASSES.argent040),
    pubkey: kp.pub,
    ...card,
    step,
  };
}

// TA-11's token: minted straight to TA-11 at deploy, so the account holds it
// and nothing else. Deployed by the bank through the UDC with unique = 1.
function tokenFixture(seed: string): SepoliaFixture {
  const ta11 = argentAddress(readyKeypair(seed, 2).pub, CLASSES.argent040);
  const calldata = CallData.compile([
    byteArray.byteArrayFromString("Bramble Test Token"),
    byteArray.byteArrayFromString("BTT"),
    cairo.uint256(STRK),
    ta11,
    deployer.address,
  ]);
  const token = `0x${BigInt(
    hash.calculateContractAddressFromHash(
      hash.computePedersenHash(deployer.address, TOKEN_SALT),
      OZ_ERC20,
      calldata,
      UDC,
    ),
  ).toString(16)}`;
  return readyFixture(
    seed,
    "s-rdy/TA-11",
    2,
    {
      expected: "holds only a test ERC-20 (not ETH/STRK): the Sepolia scan does not probe it",
      detectability: "D2",
      backedBy: "none",
      classAtDeploy: null,
    },
    async (e) => {
      if (!(await classAt(token))) {
        const { transaction_hash } = await deployer.execute({
          contractAddress: UDC,
          entrypoint: "deployContract",
          calldata: [OZ_ERC20, TOKEN_SALT, "0x1", `0x${calldata.length.toString(16)}`, ...calldata],
        });
        await provider.waitForTransaction(transaction_hash);
        e.log.push(`token-deployed ${transaction_hash}`);
        console.log(`   token deployed: ${transaction_hash.slice(0, 10)}…`);
      }
      const [low = "0x0"] = await provider.callContract({
        contractAddress: token,
        entrypoint: "balance_of",
        calldata: [e.address],
      });
      if (BigInt(low) === 0n) throw new Error("TA-11 holds none of the test token");
      return { state: { deployed: false, token, tokenBalance: low } };
    },
  );
}

/** A Ready account at `index`, deployed (if the app has not already) and guardian-shaped. */
function guardianFixture(
  seed: string,
  id: string,
  index: number,
  removeAfter: boolean,
  expected: string,
): SepoliaFixture {
  const kp = readyKeypair(seed, index);
  const setGuardian = (e: ManifestEntry) =>
    invokeSelf(e, new LegacySigner([kp]), "change_guardian", ["0x0", "0x0", GUARDIAN.pub]);
  return readyFixture(
    seed,
    id,
    index,
    { expected, detectability: "D2", backedBy: "simulated", classAtDeploy: CLASSES.argent040 },
    async (e) => {
      await selfDeploy(e, {
        signer: kp.priv,
        classHash: CLASSES.argent040,
        calldata: argentConstructor(kp.pub, CLASSES.argent040),
        salt: kp.pub,
      });
      const everSet = e.log.some((l) => l.startsWith("change_guardian"));
      if ((await viewFelt(e.address, "get_guardian")) === 0n && !everSet) await setGuardian(e);
      if (removeAfter && (await viewFelt(e.address, "get_guardian")) !== 0n) {
        await invokeSelf(e, new LegacySigner([kp, GUARDIAN]), "change_guardian", ["0x1"]);
      }
      const guardian = removeAfter ? null : GUARDIAN.pub;
      return { state: { deployed: true, liveClass: await classAt(e.address), guardian } };
    },
  );
}

const rdyFixtures = (seed: string): SepoliaFixture[] => [
  readyFixture(
    seed,
    "s-rdy/TA-09",
    0,
    {
      expected: "plain Ready 0.4.0, deployed by the Ready app: listed and signable",
      detectability: "D1",
      backedBy: "none",
      classAtDeploy: CLASSES.argent040,
    },
    fundForApp(5n * STRK, "Ready app"),
  ),
  readyFixture(
    seed,
    "s-rdy/TA-10",
    1,
    {
      expected: "Ready funded counterfactual: 'Not deployed · holds 1 STRK'",
      detectability: "D1",
      backedBy: "none",
      classAtDeploy: null,
    },
    async (e) => {
      await topUp(e, "STRK", STRK);
      return { state: { deployed: false, funded: "STRK" } };
    },
  ),
  tokenFixture(seed),
  guardianFixture(seed, "s-rdy/TA-12", 3, false, "guardian set: signing must be refused"),
  guardianFixture(seed, "s-rdy/TA-13", 4, true, "guardian removed: usable again"),
];

const xverseFixture = (seed: string): SepoliaFixture => {
  const kp = brambleKeypair(seed, 0);
  return {
    id: "s-xvs/TA-26",
    seed: sepoliaVar("S-XVS"),
    vendorDerivation: "bramble-account",
    index: 0,
    address: argentAddress(kp.pub, CLASSES.xverse040),
    pubkey: kp.pub,
    classAtDeploy: CLASSES.xverse040,
    expected: "made in the Xverse app: Xverse class on the own ladder, account 0",
    detectability: "D1",
    backedBy: "none",
    step: fundForApp(2n * STRK, "Xverse app"),
  };
};

const rdySeed = appSeed("S-RDY", "TA-09…TA-13");
const xvsSeed = appSeed("S-XVS", "TA-26 (app)");

export const RDY_FIXTURES: readonly SepoliaFixture[] = [
  ...(rdySeed ? rdyFixtures(rdySeed) : []),
  ...(xvsSeed ? [xverseFixture(xvsSeed)] : []),
];
