/**
 * Invoke write-boundary regressions distinguish preparation failures from a
 * response lost after starknet_addInvokeTransaction can have reached a node.
 */

import { describe, expect, test } from "bun:test";
import { WalletError } from "@mc-wallet/core/errors";
import { createRpcProvider, resetRpcEndpointCooldownsForTests } from "@mc-wallet/starknet/provider";
import { IndeterminateRpcWriteError, submitInvokeTransaction } from "@mc-wallet/starknet/rpc";
import type { DerivedAccountRef } from "@mc-wallet/wallet-model/accounts";
import { type Call, CallData, hash, logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

const ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const account: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: ACCOUNT_ADDRESS,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${ACCOUNT_ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const undeployedAddress = hash.calculateContractAddressFromHash(
  "0x0",
  account.classHash,
  CallData.compile([account.publicKeyX]),
  0,
);
const undeployedAccount: DerivedAccountRef = {
  ...account,
  address: undeployedAddress,
  id: `SN_MAIN:${undeployedAddress}`,
};
const call: Call = { calldata: [], contractAddress: "0x123", entrypoint: "transfer" };
const reviewedFee = { overallFee: "1000", unit: "FRI" } as const;
const feeEstimate = {
  data_gas_consumed: "0x1",
  data_gas_price: "0x1",
  gas_consumed: "0x1",
  gas_price: "0x1",
  l1_data_gas_consumed: "0x1",
  l1_data_gas_price: "0x1",
  l1_gas_consumed: "0x1",
  l1_gas_price: "0x1",
  l2_gas_consumed: "0x1",
  l2_gas_price: "0x1",
  overall_fee: "0x3e8",
  unit: "FRI",
};
const responses: Readonly<Record<string, unknown>> = {
  getBlockWithTxs: { block_number: 100, timestamp: 1_700_000_000, transactions: [] },
  getChainId: "0x534e5f4d41494e",
  getEstimateFee: [feeEstimate],
  getNonceForAddress: "0x0",
  specVersion: "0.8.1",
};

const accountProvider = (
  failAt: string,
  fetches: string[],
  signedHash: () => string | undefined,
  deployed = true,
): RpcProvider => {
  const implementations = {
    async buildTransaction(invocation: unknown): Promise<unknown> {
      if (failAt === "buildTransaction") {
        throw new Error("buildTransaction failed with private request body");
      }
      return invocation;
    },
    async fetchEndpoint(method: string): Promise<unknown> {
      fetches.push(method);
      if (failAt === method) {
        throw new Error(`${method} transport failed with private request body`);
      }
      if (failAt === "missingResult") {
        return {};
      }
      if (failAt === "malformedResult") {
        return { transaction_hash: "not-a-hash" };
      }
      if (failAt === "mismatchedResult") {
        return { transaction_hash: "0x1" };
      }
      return { transaction_hash: signedHash() };
    },
    async invoke(this: {
      buildTransaction: (invocation: unknown) => Promise<unknown>;
      fetchEndpoint: (method: string) => Promise<unknown>;
    }): Promise<unknown> {
      await this.buildTransaction({ type: "INVOKE" });
      return this.fetchEndpoint("starknet_addInvokeTransaction");
    },
    async deployAccount(this: {
      buildTransaction: (invocation: unknown) => Promise<unknown>;
      fetchEndpoint: (method: string) => Promise<unknown>;
    }): Promise<unknown> {
      await this.buildTransaction({ type: "DEPLOY_ACCOUNT" });
      return this.fetchEndpoint("starknet_addDeployAccountTransaction");
    },
  };
  const channel = new Proxy(implementations, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      if (typeof property === "symbol") {
        return undefined;
      }
      const method = String(property);
      return async () => {
        if (method === failAt) {
          throw new Error(`${method} transport failed with private request body`);
        }
        return method === "getEstimateFee" && !deployed
          ? [feeEstimate, feeEstimate]
          : responses[method];
      };
    },
  });
  return {
    channel,
    async getChainId() {
      return "0x534e5f4d41494e";
    },
    async getClassHashAt() {
      if (failAt === "getClassHashAt") {
        throw new Error("getClassHashAt transport failed with private request body");
      }
      if (!deployed) {
        throw Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });
      }
      return "0xclass";
    },
    async waitForTransaction() {},
  } as unknown as RpcProvider;
};

const submitWithFailure = async (
  failAt: string,
): Promise<{ readonly fetches: readonly string[]; readonly rejection: unknown }> => {
  const fetches: string[] = [];
  let signedHash: string | undefined;
  const rejection = await submitInvokeTransaction(
    {
      account,
      calls: [call],
      reviewedFee,
      rpcUrls: ["https://rpc.example"],
      signHash: async (messageHash) => {
        signedHash = messageHash;
        return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
      },
    },
    () => accountProvider(failAt, fetches, () => signedHash),
  ).catch((error: unknown) => error);
  return { fetches, rejection };
};

describe("invoke RPC write boundary", () => {
  test("the pinned starknet.js channel still exposes the guarded broadcast seam", () => {
    const channel: unknown = Reflect.get(createRpcProvider("https://rpc.example"), "channel");
    expect(typeof channel).toBe("object");
    expect(typeof Reflect.get(channel as object, "fetchEndpoint")).toBe("function");
    expect(typeof Reflect.get(channel as object, "invoke")).toBe("function");
  });

  test("restores retry safety for deployment checks and fee-estimation failures", async () => {
    for (const failure of ["getClassHashAt", "getEstimateFee", "buildTransaction"]) {
      resetRpcEndpointCooldownsForTests();
      const { fetches, rejection } = await submitWithFailure(failure);
      expect(rejection).toBeInstanceOf(WalletError);
      expect(rejection).not.toBeInstanceOf(IndeterminateRpcWriteError);
      expect((rejection as Error).message).toContain("could not be prepared");
      expect((rejection as Error).message).not.toContain("private request body");
      expect(fetches).toEqual([]);
    }
  });

  test("marks and redacts a lost response only after invoke reaches broadcast", async () => {
    const { fetches, rejection } = await submitWithFailure("starknet_addInvokeTransaction");
    expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
    expect((rejection as Error).message).not.toContain("private request body");
    expect(fetches).toEqual(["starknet_addInvokeTransaction"]);
  });

  test("checks live authorization immediately before invoke broadcast", async () => {
    const fetches: string[] = [];
    let signedHash: string | undefined;
    let signed = false;
    const rejection = await submitInvokeTransaction(
      {
        account,
        calls: [call],
        isAuthorized: () => false,
        reviewedFee,
        rpcUrls: ["https://rpc.example"],
        signHash: async (messageHash) => {
          signed = true;
          signedHash = messageHash;
          return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
        },
      },
      () => accountProvider("", fetches, () => signedHash),
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(WalletError);
    expect((rejection as Error).message).toBe("wallet locked");
    expect(signed).toBe(false);
    expect(fetches).toEqual([]);
  });

  test("binds the invoke result to the signed hash after automatic deployment", async () => {
    const fetches: string[] = [];
    const signedHashes: string[] = [];
    const result = await submitInvokeTransaction(
      {
        account: undeployedAccount,
        calls: [call],
        reviewedDeploymentFee: reviewedFee,
        reviewedFee,
        rpcUrls: ["https://rpc.example"],
        signHash: async (messageHash) => {
          signedHashes.push(messageHash);
          return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
        },
      },
      () => accountProvider("", fetches, () => signedHashes.at(-1), false),
    );

    expect(signedHashes).toHaveLength(2);
    expect(signedHashes[0]).not.toBe(signedHashes[1]);
    expect(signedHashes[1]).toBe(result.transactionHash);
    expect(fetches).toEqual([
      "starknet_addDeployAccountTransaction",
      "starknet_addInvokeTransaction",
    ]);
  });

  test("binds missing, malformed, and mismatched accepted hashes as indeterminate", async () => {
    for (const result of ["missingResult", "malformedResult", "mismatchedResult"]) {
      resetRpcEndpointCooldownsForTests();
      const { fetches, rejection } = await submitWithFailure(result);
      expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
      expect(fetches).toEqual(["starknet_addInvokeTransaction"]);
    }
  });
});
