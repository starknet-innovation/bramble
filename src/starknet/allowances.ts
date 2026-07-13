/**
 * Pure decoding of ERC20 `approve` calls into allowance inputs. Network-free so
 * every rule is unit-testable. The revoke call itself is built with
 * `buildErc20ApproveCall` in ./rpc, and persistence lives in the allowance
 * store.
 */
import type { Call } from "starknet";
import type { AllowanceInput } from "../storage/allowance-store";
import type { AccountRef } from "../storage/vault-schema";
import { asFelt } from "./networks";

const UINT_128_SHIFT = 128n;

/**
 * One decoded `approve(spender, amount)` call.
 */
export type DecodedApprove = {
  readonly amount: bigint;
  readonly spender: string;
};

/**
 * Decodes an ERC20 `approve(spender, amount)` call, or null when the call is
 * not a well-formed approve.
 */
export const decodeApproveCall = (call: Call): DecodedApprove | null => {
  if (call.entrypoint !== "approve") {
    return null;
  }
  const calldata = Array.isArray(call.calldata) ? call.calldata : [];
  const spender = typeof calldata[0] === "string" ? calldata[0] : null;
  const low = asFelt(calldata[1]);
  const high = asFelt(calldata[2]);
  if (spender === null || low === null || high === null) {
    return null;
  }
  return { amount: low + (high << UINT_128_SHIFT), spender };
};

/**
 * Extracts allowance inputs from every `approve` call in a submitted
 * transaction, scoped to the submitting account.
 */
export const approveAllowancesFromCalls = (
  calls: readonly Call[],
  account: AccountRef,
): readonly AllowanceInput[] =>
  calls.flatMap((call) => {
    const decoded = decodeApproveCall(call);
    return decoded
      ? [
          {
            accountId: account.id,
            amount: decoded.amount.toString(),
            networkId: account.networkId,
            spender: decoded.spender,
            token: call.contractAddress,
          },
        ]
      : [];
  });
