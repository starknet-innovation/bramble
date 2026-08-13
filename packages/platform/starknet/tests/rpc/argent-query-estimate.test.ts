/** Argent fee estimation includes account validation without private signing. */

import { expect, test } from "bun:test";
import { ARGENT_ACCOUNT_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import { estimateInvokeFee } from "@mc-wallet/starknet/rpc";
import { submitInvokeTransaction } from "@mc-wallet/starknet/rpc-submit";
import type { DerivedAccountRef } from "@mc-wallet/wallet-model/accounts";
import { logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

const account: DerivedAccountRef = {
  accountContractType: "argent",
  address: "0x123",
  classHash: ARGENT_ACCOUNT_CONTRACT.classHash,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN",
  publicKeyX: "0x789",
  publicKeyY: "0xabc",
};

const makeProvider = (liveClassHash = account.classHash) => {
  const calls: { readonly args: readonly unknown[]; readonly method: string }[] = [];
  const channel = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        const method = String(property);
        return async (...args: readonly unknown[]) => {
          calls.push({ args, method });
          if (method === "getEstimateFee") {
            return [
              {
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
                overall_fee: "0x3",
                unit: "FRI",
              },
            ];
          }
          if (method === "getChainId") return "0x534e5f4d41494e";
          if (method === "getNonceForAddress") return "0x0";
          if (method === "invoke") return { transaction_hash: "0xdeadbeef" };
          if (method === "getBlockWithTxs") {
            return { block_number: 100, timestamp: 1_700_000_000, transactions: [] };
          }
          if (method === "specVersion") return "0.8.1";
          return undefined;
        };
      },
    },
  );
  const provider = {
    channel,
    getChainId: async () => "0x534e5f4d41494e",
    getClassHashAt: async () => liveClassHash,
  } as unknown as RpcProvider;
  return { calls, provider };
};

const requestFor = (
  calls: readonly { readonly args: readonly unknown[]; readonly method: string }[],
  method: string,
): string =>
  JSON.stringify(
    calls.find((call) => call.method === method),
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );

test("Argent invoke estimates validate with a public query signature", async () => {
  const { calls, provider } = makeProvider();
  let privatelySigned = false;

  await estimateInvokeFee(
    {
      account,
      calls: [{ calldata: [], contractAddress: "0x111", entrypoint: "transfer" }],
      rpcUrls: ["https://rpc.invalid"],
      signHash: async () => {
        privatelySigned = true;
        throw new Error("private signer must not run");
      },
    },
    () => provider,
  );

  const request = requestFor(calls, "getEstimateFee");
  expect(request).toContain(`"signature":["1","0","${account.publicKeyX}","0x1","0x1"]`);
  expect(request).not.toContain("SKIP_VALIDATE");
  expect(privatelySigned).toBe(false);
});

test("Argent submission settles validation-inclusive bounds before private signing", async () => {
  const { calls, provider } = makeProvider();
  let privatelySigned = 0;
  await expect(
    submitInvokeTransaction(
      {
        account,
        calls: [{ calldata: [], contractAddress: "0x111", entrypoint: "transfer" }],
        reviewedFee: { overallFee: "100", unit: "FRI" },
        rpcUrls: ["https://rpc.invalid"],
        signHash: async () => {
          privatelySigned += 1;
          return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
        },
      },
      () => provider,
    ),
  ).resolves.toMatchObject({ transactionHash: "0xdeadbeef" });

  expect(requestFor(calls, "getEstimateFee")).toContain(
    `"signature":["1","0","${account.publicKeyX}","0x1","0x1"]`,
  );
  expect(requestFor(calls, "getEstimateFee")).not.toContain("SKIP_VALIDATE");
  expect(requestFor(calls, "invoke")).toContain(
    `"signature":["1","0","${account.publicKeyX}","0x1","0x2"]`,
  );
  expect(privatelySigned).toBe(1);
});

test("Argent invoke estimate and submission reject a different live class before signing", async () => {
  let privatelySigned = 0;
  const input = {
    account,
    calls: [{ calldata: [], contractAddress: "0x111", entrypoint: "transfer" }],
    reviewedFee: { overallFee: "100", unit: "FRI" } as const,
    rpcUrls: ["https://rpc.invalid"],
    signHash: async () => {
      privatelySigned += 1;
      return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
    },
  };

  for (const operation of [
    () => estimateInvokeFee(input, () => makeProvider("0x456").provider),
    () => submitInvokeTransaction(input, () => makeProvider("0x456").provider),
  ]) {
    await expect(operation()).rejects.toThrow("class does not match the pinned release");
  }
  expect(privatelySigned).toBe(0);
});
