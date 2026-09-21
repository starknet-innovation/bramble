/** Argent fee estimation includes account validation without private signing. */

import { expect, test } from "bun:test";
import { ARGENT_ACCOUNT_CONTRACT } from "@bramble/starknet/account-contracts";
import { estimateInvokeFee } from "@bramble/starknet/rpc";
import { submitInvokeTransaction } from "@bramble/starknet/rpc-submit";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

const account: DerivedAccountRef = {
  accountContractType: "argent",
  address: "0x123",
  classHash: ARGENT_ACCOUNT_CONTRACT.classHash,
  deploymentSalt: "0x789",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN",
  publicKeyX: "0x789",
  publicKeyY: "0xabc",
};

const makeProvider = (
  liveClassHash = account.classHash,
  liveOwner = account.publicKeyX,
  liveGuardian = "0x0",
  acceptedHash: () => string | undefined = () => "0xdeadbeef",
  liveOwnerType = "0x0",
) => {
  const calls: { readonly args: readonly unknown[]; readonly method: string }[] = [];
  const stateReads: unknown[] = [];
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
          if (method === "invoke") return { transaction_hash: acceptedHash() };
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
    callContract: async (call: { readonly entrypoint?: unknown }, block: unknown) => {
      const role =
        call.entrypoint === "get_guardian"
          ? "guardian"
          : call.entrypoint === "get_owner_type"
            ? "owner-type"
            : "owner";
      stateReads.push([role, block]);
      return [
        role === "guardian" ? liveGuardian : role === "owner-type" ? liveOwnerType : liveOwner,
      ];
    },
    getChainId: async () => "0x534e5f4d41494e",
    getBlockLatestAccepted: async () => ({ block_hash: "0xabc" }),
    getClassHashAt: async (_address: string, block: unknown) => {
      stateReads.push(["class", block]);
      return liveClassHash;
    },
  } as unknown as RpcProvider;
  return { calls, provider, stateReads };
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
  let signedHash: string | undefined;
  const { calls, provider } = makeProvider(
    account.classHash,
    account.publicKeyX,
    "0x0",
    () => signedHash,
  );
  let privatelySigned = 0;
  const result = await submitInvokeTransaction(
    {
      account,
      calls: [{ calldata: [], contractAddress: "0x111", entrypoint: "transfer" }],
      reviewedFee: { overallFee: "100", unit: "FRI" },
      rpcUrls: ["https://rpc.invalid"],
      signHash: async (messageHash) => {
        privatelySigned += 1;
        signedHash = messageHash;
        return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
      },
    },
    () => provider,
  );
  expect(signedHash).toBe(result.transactionHash);

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
    await expect(operation()).rejects.toThrow("is not a release this wallet recognizes");
  }
  expect(privatelySigned).toBe(0);
});

test("Argent operations reject a changed owner at the same accepted block", async () => {
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

  for (const operation of [estimateInvokeFee, submitInvokeTransaction]) {
    const { provider, stateReads } = makeProvider(account.classHash, "0x456");
    await expect(operation(input, () => provider)).rejects.toThrow(
      "owner does not match the wallet signer",
    );
    expect(stateReads).toEqual([
      ["class", "0xabc"],
      ["owner", "0xabc"],
      ["owner-type", "0xabc"],
    ]);
  }
  expect(privatelySigned).toBe(0);
});

test("Argent operations reject a guardian at the same accepted block", async () => {
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

  for (const operation of [estimateInvokeFee, submitInvokeTransaction]) {
    const { calls, provider, stateReads } = makeProvider(
      account.classHash,
      account.publicKeyX,
      "0x456",
    );
    await expect(operation(input, () => provider)).rejects.toThrow(
      "guardian is not supported by this wallet",
    );
    expect(stateReads).toEqual([
      ["class", "0xabc"],
      ["owner", "0xabc"],
      ["owner-type", "0xabc"],
      ["guardian", "0xabc"],
    ]);
    expect(calls).toHaveLength(0);
  }
  expect(privatelySigned).toBe(0);
});

test("Argent operations reject a non-Starknet owner type before signing", async () => {
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

  for (const operation of [estimateInvokeFee, submitInvokeTransaction]) {
    const { calls, provider, stateReads } = makeProvider(
      account.classHash,
      account.publicKeyX,
      "0x0",
      () => "0xdeadbeef",
      "0x1",
    );
    await expect(operation(input, () => provider)).rejects.toThrow(
      "owner type is not supported by this wallet",
    );
    expect(stateReads).toEqual([
      ["class", "0xabc"],
      ["owner", "0xabc"],
      ["owner-type", "0xabc"],
    ]);
    expect(calls).toHaveLength(0);
  }
  expect(privatelySigned).toBe(0);
});

test("Argent operations accept an equivalent zero guardian encoding", async () => {
  let signedHash: string | undefined;
  const input = {
    account,
    calls: [{ calldata: [], contractAddress: "0x111", entrypoint: "transfer" }],
    reviewedFee: { overallFee: "100", unit: "FRI" } as const,
    rpcUrls: ["https://rpc.invalid"],
    signHash: async (messageHash: string) => {
      signedHash = messageHash;
      return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
    },
  };

  for (const operation of [estimateInvokeFee, submitInvokeTransaction]) {
    const { provider } = makeProvider(
      account.classHash,
      account.publicKeyX,
      "0x00",
      () => signedHash,
    );
    await expect(operation(input, () => provider)).resolves.toBeDefined();
  }
});
