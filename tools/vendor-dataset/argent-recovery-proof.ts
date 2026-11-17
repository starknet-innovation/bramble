/**
 * Clean mainnet proof on a fresh guardian account: deploy a 0.4.0 account at a
 * new matrix index, set a guardian (owner-only, as the Ready app does), then
 * trigger the guardian escape through the wallet's own recovery path.
 */

import { reviewArgentRecovery, submitArgentRecovery } from "@bramble/starknet/rpc";
import { Account, ec, num, Signer } from "starknet";
import {
  argentAddress,
  argentConstructor,
  CLASSES,
  classAt,
  deployerAccount,
  envSeed,
  provider,
  readyKeypair,
  tokenBalance,
  transfer,
} from "./matrix-lib";

const RPC = ["https://mainnet.nodes.starknet.org/rpc/v0_10"];
const INDEX = 20;
const kp = readyKeypair(envSeed("BRAMBLE_DATASET_SEED_READY_MATRIX"), INDEX);
const guardian = readyKeypair(envSeed("BRAMBLE_DATASET_SEED_DEPLOYER"), 1); // a key we hold
const address = argentAddress(kp.pub, CLASSES.argent040);

// 1. deploy
if (!(await classAt(address))) {
  const strk = await tokenBalance("STRK", address);
  if (strk < 2n * 10n ** 18n)
    await transfer(deployerAccount(), "STRK", address, 2n * 10n ** 18n - strk);
  const acc = new Account({ provider, address, signer: kp.priv, cairoVersion: "1" });
  const { transaction_hash } = await acc.deployAccount({
    classHash: CLASSES.argent040,
    constructorCalldata: argentConstructor(kp.pub, CLASSES.argent040),
    addressSalt: kp.pub,
  });
  await provider.waitForTransaction(transaction_hash);
  console.log("deployed", INDEX, transaction_hash.slice(0, 12));
}
// 2. set guardian (owner-only legacy signature [r,s])
class OwnerSig extends Signer {
  constructor(private p: string) {
    super(p);
  }
  override async signRaw(h: string) {
    const s = ec.starkCurve.sign(h, this.p);
    return [num.toHex(s.r), num.toHex(s.s)];
  }
}
const get = await provider.callContract(
  { calldata: [], contractAddress: address, entrypoint: "get_guardian" },
  "latest",
);
if (BigInt(get[0] ?? "0x0") === 0n) {
  const acc = new Account({ provider, address, signer: new OwnerSig(kp.priv), cairoVersion: "1" });
  const { transaction_hash } = await acc.execute({
    contractAddress: address,
    entrypoint: "change_guardian",
    calldata: ["0x0", "0x0", guardian.pub],
  });
  await provider.waitForTransaction(transaction_hash);
  console.log("guardian set", transaction_hash.slice(0, 12));
}
// 3. trigger escape through the wallet's own path
const account = {
  accountContractType: "argent" as const,
  address,
  classHash: CLASSES.argent040,
  deploymentSalt: kp.pub,
  derivation: { addressIndex: INDEX, kind: "argentx-bip44" as const },
  id: `SN_MAIN:${address}`,
  networkId: "SN_MAIN" as const,
  publicKeyX: kp.pub,
};
const signHash = async (h: string) => {
  const s = ec.starkCurve.sign(h, kp.priv);
  return { publicKey: kp.pub, r: num.toHex(s.r), s: num.toHex(s.s) };
};
const review = await reviewArgentRecovery({ account, rpcUrls: RPC, signHash });
console.log("reviewed step:", review.step, "fee:", review.fee.overallFee, review.fee.unit);
const result = await submitArgentRecovery({
  account,
  expectedStep: review.step,
  reviewedFee: review.fee,
  rpcUrls: RPC,
  signHash,
});
console.log("escape trigger tx:", result.transactionHash);
