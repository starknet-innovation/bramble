/**
 * Node-side mainnet access for the multisig privacy round: the funding
 * account's one transfer, and the reads the round checks itself against. The
 * funding key signs here and nowhere else; it never enters a browser.
 */
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { getDeploymentStatus } from "@bramble/starknet/deployment";
import { buildErc20TransferCall } from "@bramble/starknet/rpc";
import { STRK_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import { Account, RpcProvider } from "starknet";
import { waitForSuccessfulReceipt } from "../../live/chain";
import type { LocalMainnetAccount } from "../local-mainnet-account";
import { readPublicBalance } from "../local-mainnet-chain";
import { ROUND_LIMITS } from "./round-budget";

export { strkLabel, strkTransferCall } from "./round-rules";

/** Public STRK balance of `address`, in FRI. */
export const publicStrk = async (rpcUrl: string, address: string): Promise<bigint> =>
  (await readPublicBalance(rpcUrl, address, "STRK")).raw;

/**
 * Whether the privacy pool has a registered viewing key for `address`: its
 * `get_public_key` answer is nonzero. A failed read throws.
 */
export const isRegisteredInPool = async (rpcUrl: string, address: string): Promise<boolean> => {
  const [key] = await new RpcProvider({ nodeUrl: rpcUrl }).callContract({
    calldata: [address],
    contractAddress: STRK20_MAINNET_POOL,
    entrypoint: "get_public_key",
  });
  if (typeof key !== "string") throw new Error("The pool did not answer get_public_key.");
  return BigInt(key) !== 0n;
};

/** Whether a contract is deployed at `address`. A failed read throws. */
export const isDeployed = (rpcUrl: string, address: string): Promise<boolean> =>
  getDeploymentStatus({ accountAddress: address, rpcUrls: [rpcUrl] });

/**
 * Sends `amount` FRI of STRK from the funding account to `recipient` and
 * waits for a successful receipt. The fee is estimated first; an estimate
 * above the transfer ceiling throws before anything is signed. Throws on a
 * revert or a receipt that never arrives; this function never sends twice.
 */
export const fundFromAccount = async (
  account: LocalMainnetAccount,
  recipient: string,
  amount: bigint,
): Promise<string> => {
  const provider = new RpcProvider({ nodeUrl: account.rpcUrl });
  const funding = new Account({
    address: account.address,
    provider,
    signer: account.privateKey,
  });
  const call = buildErc20TransferCall(STRK_TOKEN_ADDRESS, recipient, amount);
  const estimate = await funding.estimateInvokeFee([call]);
  if (BigInt(estimate.overall_fee) > ROUND_LIMITS.maxTransferFee) {
    throw new Error("The funding transfer's fee is above the round's ceiling. Nothing was sent.");
  }
  const sent = await funding.execute([call]);
  await waitForSuccessfulReceipt(account.rpcUrl, sent.transaction_hash);
  return sent.transaction_hash;
};
