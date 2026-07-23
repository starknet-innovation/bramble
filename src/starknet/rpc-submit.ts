/**
 * Non-retriable Starknet invoke submission through a Krusty-backed account.
 */
import type { Account, Call, RpcProvider } from "starknet";
import { WalletError } from "../shared/errors";
import { isRecord } from "../shared/json";
import type { AccountRef } from "../storage/vault-schema";
import { ensureAccountDeployed } from "./deployment";
import { STARKNET_NETWORKS } from "./networks";
import { krustyAccount, type StarkHashSigner, withRpcWrite } from "./provider";

/**
 * Fee speed control: standard uses node defaults, fast scales estimated
 * resource bounds up for faster inclusion.
 */
export type FeeSpeed = "fast" | "standard";

/**
 * Inputs for submitting one or more invoke calls.
 */
export type InvokeInput = {
  readonly account: AccountRef;
  readonly calls: readonly Call[];
  readonly rpcUrls: readonly string[];
  readonly signHash: StarkHashSigner;
  readonly speed?: FeeSpeed;
};

/**
 * Generic invoke submission result.
 */
export type InvokeSubmission = {
  readonly calls: readonly Call[];
  readonly transactionHash: string;
};

const scaledBounds = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return (value * 3n) / 2n;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, scaledBounds(entry)]),
    );
  }
  if (typeof value === "string" && /^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    const scaled = (BigInt(value) * 3n) / 2n;
    return value.startsWith("0x") ? `0x${scaled.toString(16)}` : scaled.toString();
  }
  return value;
};

/**
 * Signs and submits generic Starknet invoke calls exactly once after selecting
 * a chain-matching RPC endpoint. Once submission starts, transport ambiguity
 * is returned to the caller and never replayed against a fallback endpoint.
 */
export const submitInvokeTransaction = async (
  { account, calls, rpcUrls, signHash, speed = "standard" }: InvokeInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<InvokeSubmission> => {
  if (calls.length === 0) {
    throw new WalletError("No calls to submit");
  }
  return withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      const starknetAccount = krustyAccount(provider, account, signHash);
      await ensureAccountDeployed(provider, starknetAccount, account);
      const details =
        speed === "fast"
          ? {
              resourceBounds: scaledBounds(
                (await starknetAccount.estimateInvokeFee([...calls])).resourceBounds,
              ),
            }
          : {};
      const result = await starknetAccount.execute(
        [...calls],
        details as Parameters<Account["execute"]>[1],
      );
      return {
        calls,
        transactionHash: result.transaction_hash,
      };
    },
    makeProvider,
  );
};
