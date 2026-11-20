/**
 * Mainnet-only reads for the opt-in wallet suite: mainnet tokens and balances,
 * and the SNIP-12 message checked on-chain with `is_valid_signature`. Chain
 * reads shared with other networks live in `../live/chain`. Nothing here signs
 * or logs a key.
 */
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { TokenConfig } from "@bramble/wallet-model/preferences";
import { RpcProvider, shortString, typedData } from "starknet";
import { defaultToken, readTokenBalance } from "../live/chain";

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
export const mainnetToken = (symbol: "ETH" | "STRK"): TokenConfig =>
  defaultToken("SN_MAIN", symbol);

/**
 * Public mainnet ERC-20 balance of ETH or STRK. `raw` is base units.
 */
export const readPublicBalance = (
  rpcUrl: string,
  address: string,
  symbol: "ETH" | "STRK",
): Promise<{ readonly formatted: string; readonly raw: bigint }> =>
  readTokenBalance(rpcUrl, address, mainnetToken(symbol));

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
