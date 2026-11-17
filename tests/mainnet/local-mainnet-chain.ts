/**
 * Mainnet reads for the opt-in wallet suite: public balances, a successful
 * receipt, and an on-chain `is_valid_signature` check. Nothing here signs or
 * logs a key.
 */
import { getTokenBalances, readReceiptFee } from "@bramble/starknet/rpc";
import { DEFAULT_TOKENS, STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { type TokenConfig, withTokenId } from "@bramble/wallet-model/preferences";
import { RpcProvider, shortString, typedData } from "starknet";
import {
  receiptReverted,
  receiptSucceeded,
  transferredAmount,
} from "../../scripts/gasless-mainnet-receipt";

const RECEIPT_TIMEOUT_MS = 4 * 60_000;
const RECEIPT_INTERVAL_MS = 4_000;

/** Cairo short string `VALID`, the account's accepted `is_valid_signature` answer. */
export const VALID_SIGNATURE = shortString.encodeShortString("VALID");

/**
 * SNIP-12 revision 1 message the sign spec asks the wallet to sign and then
 * checks on the account contract. `contents` is a short string.
 */
export const mainnetSignTypedData = {
  domain: {
    chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
    name: "Bramble",
    revision: "1",
    version: "1",
  },
  message: { contents: "bramble-mainnet-e2e" },
  primaryType: "Message",
  types: {
    Message: [{ name: "contents", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "felt" },
      { name: "version", type: "felt" },
      { name: "chainId", type: "felt" },
    ],
  },
} as const;

/**
 * The default mainnet ETH or STRK token, with the same id the wallet stores.
 */
export const mainnetToken = (symbol: "ETH" | "STRK"): TokenConfig => {
  const token = DEFAULT_TOKENS.find(
    (entry) => entry.networkId === "SN_MAIN" && entry.symbol === symbol,
  );
  if (!token) {
    throw new Error(`Default ${symbol} token is missing`);
  }
  return withTokenId(token);
};

/**
 * Public ERC-20 balance of ETH or STRK. `raw` is base units.
 */
export const readPublicBalance = async (
  rpcUrl: string,
  address: string,
  symbol: "ETH" | "STRK",
): Promise<{ readonly formatted: string; readonly raw: bigint }> => {
  const token = mainnetToken(symbol);
  const balances = await getTokenBalances({
    accountAddress: address,
    rpcUrls: [rpcUrl],
    tokens: [token],
  });
  const found = balances[0];
  if (!found) {
    throw new Error(`No ${symbol} balance was returned`);
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

/**
 * Calldata for `is_valid_signature(hash, signature)`. The span is length-prefixed.
 */
export const isValidSignatureCalldata = (
  messageHash: string,
  signature: readonly string[],
): readonly string[] => [messageHash, `0x${signature.length.toString(16)}`, ...signature];

/**
 * SNIP-12 message hash the account contract checks. `account` is the signer.
 */
export const signMessageHash = (account: string): string =>
  typedData.getMessageHash(
    mainnetSignTypedData as unknown as Parameters<typeof typedData.getMessageHash>[0],
    account,
  );

/**
 * Whether an `is_valid_signature` return value contains the `VALID` short string.
 */
export const isValidSignatureResult = (result: readonly string[]): boolean =>
  result.some((felt) => sameFelt(felt, VALID_SIGNATURE));

/**
 * Calls the account's `is_valid_signature` and returns the felts it answered.
 */
export const readIsValidSignature = async (
  rpcUrl: string,
  account: string,
  messageHash: string,
  signature: readonly string[],
): Promise<readonly string[]> => {
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const result = await provider.callContract({
    calldata: [...isValidSignatureCalldata(messageHash, signature)],
    contractAddress: account,
    entrypoint: "is_valid_signature",
  });
  return result.map(String);
};
