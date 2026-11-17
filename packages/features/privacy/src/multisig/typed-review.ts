/**
 * Review of a relay's SNIP-9 typed data. The only typed data this flow signs
 * is the paymaster's outside execution for public token approvals to the
 * pool. It is rebuilt from the decoded approvals with this wallet's account,
 * chain, and clock, so a foreign domain, another primary type, an expired
 * window, or any other call is refused rather than shown.
 */

import { isRecord } from "@bramble/core/json";
import { formatTokenAmount } from "@bramble/starknet/rpc";
import { canonicalFelt, sameFelt, UINT128_LIMIT } from "@bramble/wallet-model/networks";
import { type Call, hash, type TypedData, typedData } from "starknet";
import { bindPaymasterTypedData } from "../paymaster/paymaster-typed-data";
import {
  type MultisigStrk20Review,
  type MultisigStrk20ReviewScope,
  reviewScopeLines,
} from "./review-scope";

type Approval = { readonly call: Call; readonly line: string };

const rawCalls = (message: Record<string, unknown>): readonly unknown[] | null => {
  const calls = message["Calls"] ?? message["calls"];
  return Array.isArray(calls) && calls.length > 0 && calls.length <= 8 ? calls : null;
};

const field = (call: Record<string, unknown>, upper: string, lower: string): unknown =>
  call[upper] ?? call[lower];

const approvalFrom = (value: unknown, scope: MultisigStrk20ReviewScope): Approval | null => {
  if (!isRecord(value)) return null;
  const to = field(value, "To", "to");
  const selector = field(value, "Selector", "selector");
  const calldata = field(value, "Calldata", "calldata");
  if (typeof to !== "string" || typeof selector !== "string" || !Array.isArray(calldata)) {
    return null;
  }
  const token = scope.tokens.find((candidate) => sameFelt(candidate.address, to));
  const [spender, low, high] = calldata.map((felt) =>
    typeof felt === "string" ? canonicalFelt(felt) : null,
  );
  if (
    !token ||
    calldata.length !== 3 ||
    !sameFelt(selector, hash.getSelectorFromName("approve")) ||
    !spender ||
    !low ||
    !high ||
    !sameFelt(spender, scope.poolAddress) ||
    BigInt(low) >= UINT128_LIMIT ||
    BigInt(high) >= UINT128_LIMIT
  ) {
    return null;
  }
  const amount = (BigInt(high) << 128n) + BigInt(low);
  return {
    call: { calldata: [spender, low, high], contractAddress: to, entrypoint: "approve" },
    line: `Allow the privacy pool to spend ${formatTokenAmount(amount, token.decimals)} ${token.symbol}`,
  };
};

const digest = (value: unknown, accountAddress: string): string | null => {
  try {
    return canonicalFelt(typedData.getMessageHash(value as TypedData, accountAddress));
  } catch {
    return null;
  }
};

/**
 * The relay typed data as the signer should read it. Returns null unless every
 * call is a tracked token's `approve` to the configured pool, the envelope
 * rebuilds to the same digest for this account and chain with a live window,
 * and that digest is `messageHash`.
 */
export const reviewMultisigStrk20TypedData = (
  value: unknown,
  messageHash: string,
  nowSeconds: number,
  scope: MultisigStrk20ReviewScope,
): MultisigStrk20Review | null => {
  if (!isRecord(value) || !isRecord(value["message"])) return null;
  const calls = rawCalls(value["message"]);
  const approvals = calls?.map((call) => approvalFrom(call, scope));
  if (!approvals || approvals.some((approval) => approval === null)) return null;
  const decoded = approvals as readonly Approval[];
  const bound = bindPaymasterTypedData({
    accountAddress: scope.accountAddress,
    calls: decoded.map((approval) => approval.call),
    chainId: scope.chainId,
    nowSeconds,
    value,
  });
  const signed = bound ? digest(bound.typedData, scope.accountAddress) : null;
  if (!bound || !signed || !sameFelt(signed, messageHash)) return null;
  return {
    lines: [
      ...reviewScopeLines(scope),
      ...decoded.map((approval) => approval.line),
      `Relayer ${canonicalFelt(bound.review.caller) ?? bound.review.caller}`,
    ],
    title: "Token approval",
  };
};
