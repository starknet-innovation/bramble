/**
 * Mainnet proof for the wallet's Braavos deployment path: estimates and
 * submits the deployment of braavos-matrix/5 through the REPO's own platform
 * functions (estimateAccountDeploymentFee / submitAccountDeployment), with
 * signHash standing in for the vault signer. Prints addresses/hashes only.
 */
import { ec, num, hash as snHash } from "starknet";
import {
  braavosKeypair,
  CLASSES,
  classAt,
  deployerAccount,
  envSeed,
  tokenBalance,
  transfer,
} from "./matrix-lib";
import {
  estimateAccountDeploymentFee,
  submitAccountDeployment,
} from "/Users/henri/Workshop/mc-wallet/packages/platform/starknet/src/transactions/deployment.ts";

const RPC = ["https://mainnet.nodes.starknet.org/rpc/v0_10"];
const kp = braavosKeypair(envSeed("BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX"), 6);
const address =
  "0x" +
  BigInt(snHash.calculateContractAddressFromHash(kp.pub, CLASSES.braavosDeploy, [kp.pub], 0)).toString(16);
console.log("fixture braavos-matrix/6:", address);

if (await classAt(address)) {
  console.log("already deployed; nothing to prove");
  process.exit(0);
}
const strk = await tokenBalance("STRK", address);
if (strk < 2n * 10n ** 18n) {
  const tx = await transfer(deployerAccount(), "STRK", address, 2n * 10n ** 18n - strk);
  console.log("fee float:", tx.slice(0, 12) + "…");
}

const account = {
  accountContractType: "braavos" as const,
  address,
  classHash: CLASSES.braavosDeploy,
  deploymentSalt: kp.pub,
  derivation: { accountIndex: 0, addressIndex: 5, kind: "starknet-bip44" as const },
  id: `SN_MAIN:${address}`,
  networkId: "SN_MAIN" as const,
  publicKeyX: kp.pub,
  publicKeyY: "0x1",
};
const signHash = async (messageHash: string) => {
  const sig = ec.starkCurve.sign(messageHash, kp.priv);
  return { publicKey: kp.pub, r: num.toHex(sig.r), s: num.toHex(sig.s) };
};

const reviewedFee = await estimateAccountDeploymentFee({ account, rpcUrls: RPC, signHash });
console.log("estimated fee:", reviewedFee.overallFee, reviewedFee.unit);
const submitted = await submitAccountDeployment({ account, reviewedFee, rpcUrls: RPC, signHash });
console.log("deploy tx:", submitted.transactionHash);
