/**
 * Token amount for a multisig STRK20 action. The token is one the wallet
 * already tracks; its decimals are the same ones the single-signer privacy
 * flows use. The raw felt is what the pool action stores.
 */

import { WalletError } from "@bramble/core/errors";
import { formatTokenAmount, parseTokenAmount } from "@bramble/starknet/rpc";
import { canonicalFelt, sameFelt } from "@bramble/wallet-model/networks";
import type { MultisigStrk20ActionRequest } from "./records";

/**
 * A tracked token the amount is denominated in.
 */
export type MultisigStrk20TrackedToken = {
  readonly address: string;
  readonly decimals: number;
  readonly id: string;
  readonly networkId: string;
  readonly symbol: string;
};

/**
 * Resolves a decimal amount in a tracked token to the raw felt the pool stores.
 * An unknown token or a rejected amount returns an error string and does not throw.
 */
export const resolveMultisigStrk20Amount = (
  tokens: readonly MultisigStrk20TrackedToken[],
  networkId: string,
  tokenId: string,
  amount: string,
):
  | { readonly error: string }
  | { readonly raw: string; readonly symbol: string; readonly token: string } => {
  const token = tokens.find(
    (candidate) => candidate.id === tokenId && candidate.networkId === networkId,
  );
  const address = token ? canonicalFelt(token.address) : null;
  if (!token || !address) return { error: "That token isn't tracked on this network." };
  try {
    return {
      raw: `0x${parseTokenAmount(amount, token.decimals).toString(16)}`,
      symbol: token.symbol,
      token: address,
    };
  } catch (error) {
    return {
      error: error instanceof WalletError ? error.message : "invalid multisig private action",
    };
  }
};

/**
 * Display facts for one stored request. Amount is the token's decimal spelling.
 * An untracked token keeps the raw felt and a short address as its symbol.
 */
export const describeMultisigStrk20Request = (
  request: MultisigStrk20ActionRequest,
  tokens: readonly Pick<MultisigStrk20TrackedToken, "address" | "decimals" | "symbol">[],
): { readonly amount: string; readonly recipient?: string; readonly symbol: string } => {
  if (request.kind === "register" || !request.amount || !request.token) {
    return { amount: "", symbol: "" };
  }
  const token = tokens.find((candidate) => sameFelt(candidate.address, request.token ?? ""));
  let amount = request.amount;
  try {
    amount = token ? formatTokenAmount(BigInt(request.amount), token.decimals) : request.amount;
  } catch {
    amount = request.amount;
  }
  return {
    amount,
    ...(request.recipient ? { recipient: request.recipient } : {}),
    symbol: token?.symbol ?? request.token,
  };
};
