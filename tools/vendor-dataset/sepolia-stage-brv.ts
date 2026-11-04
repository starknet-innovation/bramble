/**
 * Sepolia fixtures on S-BRV (Braavos ladder, script-deployed: TA-27…TA-29).
 * Braavos deploys carry the extended deploy signature (see BraavosDeploySigner); the
 * 2FA account registers K-P256 as its secp256r1 signer at deploy.
 */
import { createECDH } from "node:crypto";
import { hash, num, uint256 } from "starknet";
import { braavosKeypair, CHAIN_ID, CLASSES } from "./matrix-lib";
import { BraavosDeploySigner, type KP } from "./matrix-signers";
import { norm, type SepoliaFixture, STRK, selfDeploy, topUp } from "./sepolia-fixtures";
import { sepoliaSecret, sepoliaVar } from "./sepolia-seeds";

const braavos = (index: number): KP => braavosKeypair(sepoliaSecret("S-BRV"), index);
const u256felts = (v: bigint): [string, string] => {
  const u = uint256.bnToUint256(v);
  return [num.toHex(u.low), num.toHex(u.high)];
};

// K-P256's public point, as the Braavos secp256r1 signer stores it.
const r1 = (() => {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(sepoliaSecret("K-P256").slice(2), "hex"));
  const point = ecdh.getPublicKey(); // 0x04 || x (32 bytes) || y (32 bytes)
  return {
    x: BigInt(`0x${point.subarray(1, 33).toString("hex")}`),
    y: BigInt(`0x${point.subarray(33, 65).toString("hex")}`),
  };
})();

// AdditionalDeploymentParams: impl, signer_type, secp256r1 (u256 x, u256 y),
// multisig_threshold, withdrawal_limit_low, fee_rate, stark_fee_rate, chain_id.
const deployParams = (twoFa: boolean): string[] => [
  CLASSES.braavosImpl,
  twoFa ? "0x2" : "0x0", // SignerType::Secp256r1, or Empty
  ...(twoFa ? [...u256felts(r1.x), ...u256felts(r1.y)] : ["0x0", "0x0", "0x0", "0x0"]),
  "0x0",
  "0x0",
  "0x0",
  "0x0",
  CHAIN_ID,
];

function braavosFixture(
  id: string,
  index: number,
  mode: "deploy" | "fund" | "2fa",
  expected: string,
): SepoliaFixture {
  const kp = braavos(index);
  return {
    id,
    seed: sepoliaVar("S-BRV"),
    vendorDerivation: "braavos-direct",
    index,
    address: norm(
      hash.calculateContractAddressFromHash(kp.pub, CLASSES.braavosDeploy, [kp.pub], 0),
    ),
    pubkey: kp.pub,
    classAtDeploy: mode === "fund" ? null : CLASSES.braavosDeploy,
    expected,
    detectability: mode === "fund" ? "D1" : "D2",
    backedBy: mode === "2fa" ? "simulated" : "none",
    step: async (e) => {
      if (mode === "fund") {
        await topUp(e, "STRK", STRK);
        return { state: { deployed: false, funded: "STRK" } };
      }
      const liveClass = await selfDeploy(e, {
        signer: new BraavosDeploySigner(kp, deployParams(mode === "2fa")),
        classHash: CLASSES.braavosDeploy,
        calldata: [kp.pub],
        salt: kp.pub,
      });
      const secp256r1 = mode === "2fa" ? { x: num.toHex(r1.x), y: num.toHex(r1.y) } : undefined;
      return { state: { deployed: true, liveClass, ...(secp256r1 && { secp256r1 }) } };
    },
  };
}

export const BRV_FIXTURES: readonly SepoliaFixture[] = [
  braavosFixture("s-brv/TA-27", 0, "deploy", "Braavos 1.0.0, current implementation"),
  braavosFixture("s-brv/TA-28", 1, "fund", "Braavos funded counterfactual, deployable"),
  braavosFixture("s-brv/TA-29", 2, "2fa", "2FA: stark-key signing must be refused"),
];
