/**
 * The privacy pool's protocol fee, read from mainnet under one hard ceiling
 * shared by every live suite that pays it.
 */
import { STRK20_MAINNET_POOL } from "@bramble/privacy/config";
import type { RpcProvider } from "starknet";

/** A pool fee above this stops a live suite before anything is signed. */
export const MAX_PROTOCOL_FEE_RAW = 5n * 10n ** 18n;

/**
 * Reads `get_fee_amount` from the mainnet pool, in FRI. Throws when the answer
 * is malformed or above {@link MAX_PROTOCOL_FEE_RAW}; nothing is spent.
 */
export const readProtocolFee = async (provider: RpcProvider): Promise<bigint> => {
  const response = await provider.callContract({
    calldata: [],
    contractAddress: STRK20_MAINNET_POOL,
    entrypoint: "get_fee_amount",
  });
  const value = response[0];
  if (typeof value !== "string") {
    throw new Error("Privacy pool returned an invalid protocol fee");
  }
  const fee = BigInt(value);
  if (fee < 0n || fee > MAX_PROTOCOL_FEE_RAW) {
    throw new Error("Privacy pool protocol fee exceeds the live-test safety cap");
  }
  return fee;
};
