/** Auto-deploy invoke ordering and durable-side-effect disclosure. */

import { describe, expect, test } from "bun:test";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import { type InvokeInput, submitInvokeTransaction } from "@bramble/starknet/rpc-submit";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { type Call, CallData, hash, logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const CLASS_HASH = "0x2b31e19e45c06f29234e06e2ee98a9966479ba3067f8785ed972794fdb0065c";
const ADDRESS = hash.calculateContractAddressFromHash(
  "0x0",
  CLASS_HASH,
  CallData.compile([PUBLIC_KEY]),
  0,
);
const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: ADDRESS,
  classHash: CLASS_HASH,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const calls: Call[] = [{ calldata: [], contractAddress: "0x123", entrypoint: "transfer" }];
const estimate = {
  l1_data_gas_consumed: "0x1",
  l1_data_gas_price: "0x1",
  l1_gas_consumed: "0x1",
  l1_gas_price: "0x1",
  l2_gas_consumed: "0x1",
  l2_gas_price: "0x1",
  overall_fee: "0x3",
  unit: "FRI",
};

type Seen = {
  deploys: number;
  estimateBatchSizes: number[];
  invokes: number;
  signedHashes: string[];
};

const undeployedProvider = (
  invokeHash: string | null,
  nonceAfterDeploy: "ok" | "fails" = "ok",
): { provider: RpcProvider; seen: Seen } => {
  const seen: Seen = { deploys: 0, estimateBatchSizes: [], invokes: 0, signedHashes: [] };
  const channel = new Proxy(
    {
      async deployAccount() {
        seen.deploys += 1;
        return { transaction_hash: seen.signedHashes[0] };
      },
      async getNonceForAddress() {
        if (nonceAfterDeploy === "fails" && seen.deploys > 0) {
          throw Object.assign(new Error("internal error"), { baseError: { code: -32603 } });
        }
        return "0x0";
      },
      async getEstimateFee(invocations: readonly unknown[]) {
        seen.estimateBatchSizes.push(invocations.length);
        return invocations.map(() => estimate);
      },
      async invoke() {
        seen.invokes += 1;
        if (invokeHash === "signed") return { transaction_hash: seen.signedHashes[1] };
        return invokeHash === null
          ? Promise.reject(Object.assign(new Error("invoke rejected"), { baseError: { code: 53 } }))
          : { transaction_hash: invokeHash };
      },
    },
    {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) {
          return Reflect.get(target, property, receiver);
        }
        if (typeof property === "symbol") {
          return undefined;
        }
        const responses: Readonly<Record<string, unknown>> = {
          getBlockWithTxs: { block_number: 1, timestamp: 1, transactions: [] },
          getChainId: "0x534e5f4d41494e",
          specVersion: "0.8.1",
        };
        return async () => responses[String(property)];
      },
    },
  );
  const provider = {
    channel,
    async getChainId() {
      return "0x534e5f4d41494e";
    },
    async getClassHashAt() {
      throw Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });
    },
    async waitForTransaction() {
      return { execution_status: "SUCCEEDED" };
    },
  } as unknown as RpcProvider;
  return { provider, seen };
};

const submit = async (
  provider: RpcProvider,
  reviewedFee: string,
  signedHashes: string[],
  onSigned?: InvokeInput["onSigned"],
): Promise<unknown> =>
  submitInvokeTransaction(
    {
      account,
      ...(onSigned ? { onSigned } : {}),
      calls,
      reviewedDeploymentFee: { overallFee: "100000", unit: "FRI" },
      reviewedFee: { overallFee: reviewedFee, unit: "FRI" },
      rpcUrls: ["https://rpc.example"],
      async signHash(messageHash) {
        signedHashes.push(messageHash);
        return { publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" };
      },
    },
    () => provider,
  ).catch((error: unknown) => error);

describe("auto-deployed invoke submission", () => {
  test("settles invoke bounds against deploy-then-invoke state before broadcasting deployment", async () => {
    const { provider, seen } = undeployedProvider("0xcafe");
    const result = await submit(provider, "1", seen.signedHashes);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("rose above the amount you reviewed");
    expect(seen.estimateBatchSizes).toEqual([2]);
    expect(seen.deploys).toBe(0);
    expect(seen.invokes).toBe(0);
  });

  test.each([
    ["a rejected invoke", null, false],
    ["a malformed invoke success hash", "not-a-hash", true],
  ])("reports the accepted deployment hash after %s", async (_label, invokeHash, unknown) => {
    const { provider, seen } = undeployedProvider(invokeHash);
    const result = await submit(provider, "100000", seen.signedHashes);

    expect(result).toBeInstanceOf(Error);
    // Audit #173: an invoke whose outcome is unknown must stay typed as
    // indeterminate after the deployment re-wrap, or the Send screen offers
    // a blind re-sign of a transfer that may already be on chain.
    expect(result instanceof IndeterminateRpcWriteError).toBe(unknown);
    expect((result as Error).message).toContain(
      `Account deployment ${seen.signedHashes[0]} completed`,
    );
    expect((result as Error).message).toContain("Check on-chain state before retrying");
    expect(seen.estimateBatchSizes).toEqual([2, 1]);
    expect(seen.deploys).toBe(1);
    expect(seen.invokes).toBe(1);
  });

  test("names the completed deployment when the invoke nonce read fails after it", async () => {
    const { provider, seen } = undeployedProvider("0xcafe", "fails");
    const journaled: unknown[] = [];
    const result = await submit(provider, "100000", seen.signedHashes, async (signed) => {
      journaled.push(signed);
    });

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain(
      `Account deployment ${seen.signedHashes[0]} completed`,
    );
    expect(seen.deploys).toBe(1);
    expect(seen.invokes).toBe(0);
    expect(journaled).toEqual([]);
  });

  // mc-wallet 712: the caller records the deployment in Activity, so a send
  // that deployed the account first names that deployment on success.
  test("names the accepted deployment on a successful deploy-then-invoke send", async () => {
    const { provider, seen } = undeployedProvider("signed");
    const result = (await submit(provider, "100000", seen.signedHashes)) as unknown as {
      readonly deploymentTransactionHash?: string;
      readonly transactionHash: string;
    };

    expect(result).not.toBeInstanceOf(Error);
    expect(result.deploymentTransactionHash).toBe(seen.signedHashes[0] ?? "missing");
    expect(result.transactionHash).toBe(seen.signedHashes[1] ?? "missing");
    expect(seen.deploys).toBe(1);
    expect(seen.invokes).toBe(1);
  });
});
