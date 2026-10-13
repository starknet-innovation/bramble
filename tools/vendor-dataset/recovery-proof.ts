/**
 * Mainnet proof for the wallet's Braavos recovery path: reviews and submits the
 * deferred 2FA removal for braavos-matrix/4 (simulated 2FA, no real device)
 * through the REPO's own reviewBraavosRecovery / submitBraavosRecovery. Prints
 * the request hash and when the account becomes usable.
 */
import { ec, num, hash as snHash } from "starknet";
import { braavosKeypair, CLASSES, classAt, deployerAccount, envSeed, tokenBalance, transfer } from "./matrix-lib";
import {
  getBraavosRecoveryState,
  reviewBraavosRecovery,
  submitBraavosRecovery,
} from "@bramble/starknet/rpc";

const RPC = ["https://mainnet.nodes.starknet.org/rpc/v0_10"];
const kp = braavosKeypair(envSeed("BRAMBLE_DATASET_SEED_BRAAVOS_MATRIX"), 4);
const address =
  "0x" + BigInt(snHash.calculateContractAddressFromHash(kp.pub, CLASSES.braavosDeploy, [kp.pub], 0)).toString(16);
console.log("braavos-matrix/4:", address, "class:", await classAt(address));

const before = await getBraavosRecoveryState({ accountAddress: address, rpcUrls: RPC });
console.log("recovery state before:", before);
if (before.pendingUntil !== null) {
  console.log("removal already pending; nothing to submit");
  process.exit(0);
}

const strk = await tokenBalance("STRK", address);
if (strk < 3n * 10n ** 18n) {
  await transfer(deployerAccount(), "STRK", address, 3n * 10n ** 18n - strk);
  console.log("funded for the request fee");
}

const account = {
  accountContractType: "braavos" as const,
  address,
  classHash: CLASSES.braavosDeploy,
  deploymentSalt: kp.pub,
  derivation: { accountIndex: 0, addressIndex: 4, kind: "starknet-bip44" as const },
  id: `SN_MAIN:${address}`,
  networkId: "SN_MAIN" as const,
  publicKeyX: kp.pub,
  publicKeyY: "0x1",
};
const signHash = async (messageHash: string) => {
  const sig = ec.starkCurve.sign(messageHash, kp.priv);
  return { publicKey: kp.pub, r: num.toHex(sig.r), s: num.toHex(sig.s) };
};

const fee = await reviewBraavosRecovery({ account, rpcUrls: RPC, signHash });
console.log("reviewed fee:", fee.overallFee, fee.unit);
const result = await submitBraavosRecovery({ account, reviewedFee: fee, rpcUrls: RPC, signHash });
console.log("removal request tx:", result.transactionHash);
console.log("usable after (unix):", result.pendingUntil);
