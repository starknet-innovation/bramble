/**
 * Node-side mainnet access for the multisig privacy round: the funding
 * account's one transfer, and the reads the round checks itself against. The
 * funding key signs here and nowhere else; it never enters a browser.
 */
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import { getDeploymentStatus } from "@bramble/starknet/deployment";
import { buildErc20TransferCall, formatTokenAmount } from "@bramble/starknet/rpc";
import {
  canonicalFelt,
  STRK_TOKEN_ADDRESS,
  STRK_TOKEN_DECIMALS,
} from "@bramble/wallet-model/networks";
import { Account, num, RpcProvider } from "starknet";
import type { LocalMainnetAccount } from "../local-mainnet-account";
import { readPublicBalance, waitForSuccessfulReceipt } from "../local-mainnet-chain";
import { ROUND_LIMITS } from "./round-budget";

/** A call in the canonical shape the wallet freezes into a multisig transaction. */
export type CanonicalCall = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

const canonical = (value: unknown): string => {
  const felt = canonicalFelt(num.toHex(value as Parameters<typeof num.toHex>[0]));
  if (felt === null) {
    throw new Error("A call field is not a felt.");
  }
  return felt;
};

/** One STRK transfer of `amount` FRI to `recipient`, with canonical felts. */
export const strkTransferCall = (recipient: string, amount: bigint): CanonicalCall => {
  const call = buildErc20TransferCall(STRK_TOKEN_ADDRESS, recipient, amount);
  return {
    calldata: (call.calldata as readonly unknown[]).map(canonical),
    contractAddress: canonical(call.contractAddress),
    entrypoint: call.entrypoint,
  };
};

/** STRK in FRI as the decimal figure a person would read. */
export const strkLabel = (raw: bigint): string => formatTokenAmount(raw, STRK_TOKEN_DECIMALS);

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
