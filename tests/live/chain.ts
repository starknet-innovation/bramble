/**
 * Chain reads shared by the live wallet suites (mainnet today, Sepolia next):
 * default tokens, public balances, a successful receipt and what it moved.
 * Nothing here signs or logs a key.
 */
import { getTokenBalances, readReceiptFee } from "@bramble/starknet/rpc";
import { DEFAULT_TOKENS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import { type TokenConfig, withTokenId } from "@bramble/wallet-model/preferences";
import { RpcProvider } from "starknet";
import {
  receiptReverted,
  receiptSucceeded,
  transferredAmount,
} from "../../scripts/gasless-mainnet-receipt";

const RECEIPT_TIMEOUT_MS = 4 * 60_000;
const RECEIPT_INTERVAL_MS = 4_000;

/**
 * The wallet's default ETH or STRK token on `networkId`, with the id the wallet stores.
 */
export const defaultToken = (networkId: StarknetNetworkId, symbol: "ETH" | "STRK"): TokenConfig => {
  const token = DEFAULT_TOKENS.find(
    (entry) => entry.networkId === networkId && entry.symbol === symbol,
  );
  if (!token) {
    throw new Error(`Default ${symbol} token is missing on ${networkId}`);
  }
  return withTokenId(token);
};

/**
 * Public ERC-20 balance of `token` held by `address`. `raw` is base units.
 */
export const readTokenBalance = async (
  rpcUrl: string,
  address: string,
  token: TokenConfig,
): Promise<{ readonly formatted: string; readonly raw: bigint }> => {
  const balances = await getTokenBalances({
    accountAddress: address,
    rpcUrls: [rpcUrl],
    tokens: [token],
  });
  const found = balances[0];
  if (!found) {
    throw new Error(`No ${token.symbol} balance was returned`);
  }
  return { formatted: found.formatted, raw: BigInt(found.balance) };
};

/**
 * Polls until the receipt succeeded. A revert throws. Transport errors and a
 * not-yet-visible hash are retried until the deadline.
 */
export const waitForSuccessfulReceipt = async (rpcUrl: string, hash: string): Promise<unknown> => {
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receiptSucceeded(receipt)) {
        return receipt;
      }
      if (receiptReverted(receipt)) {
        throw new Error("The transaction reverted.");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "The transaction reverted.") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for a successful receipt.");
};

/**
 * STRK fee reported on a successful receipt, in FRI base units.
 */
export const receiptStrkFee = (receipt: unknown): bigint => {
  const fee = readReceiptFee(receipt);
  if (fee?.unit !== "FRI") {
    throw new Error("The receipt did not report a STRK fee.");
  }
  return BigInt(fee.amount);
};

/**
 * Sum of ERC-20 transfers from `account` back to itself on `token`.
 */
export const transferredToSelf = (
  receipt: unknown,
  token: string,
  account: string,
): bigint | null => transferredAmount(receipt, token, account, account);
